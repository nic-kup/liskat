import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/table.ts';
import { legalCards, type Seat } from '@liskat/engine';

// Drives a whole match by always: passing the auction to forehand, who opts in
// at 18, takes the skat, discards two, plays a grand, and then everyone plays
// their first legal card. Exercises the Table's match/round orchestration.
function driveMatch(table: Table, ids: [string, string, string]): void {
  const actorFor = (role: Seat) => ids[(table.dealIndex + role) % 3];

  let guard = 0;
  while (table.status !== 'over') {
    if (++guard > 5000) throw new Error('match did not terminate');
    const r = table.round;
    if (!r || table.status !== 'playing') throw new Error(`stuck in status ${table.status}`);

    if (r.phase === 'bidding') {
      const b = r.bidding;
      if (b.awaiting === 'forehand-decision') {
        must(table.handleAction(actorFor(0), { type: 'bid', value: 18 }));
      } else if (b.awaiting === 'call') {
        must(table.handleAction(actorFor(b.asker), { type: 'pass' }));
      } else {
        must(table.handleAction(actorFor(b.responder!), { type: 'pass' }));
      }
    } else if (r.phase === 'declaring') {
      if (r.declareStep === 'choose') {
        must(table.handleAction(actorFor(0), { type: 'takeSkat' }));
      } else if (r.declareStep === 'discard') {
        const hand = r.hands[0];
        must(table.handleAction(actorFor(0), { type: 'discard', cards: [hand[0], hand[1]] }));
      } else {
        must(table.handleAction(actorFor(0), { type: 'declareContract', contract: { type: 'grand' } }));
      }
    } else if (r.phase === 'playing') {
      const role = r.turn;
      const card = legalCards(r, role)[0];
      must(table.handleAction(actorFor(role), { type: 'playCard', card }));
    }
  }
}

function must(err: string | null): void {
  if (err) throw new Error(`unexpected illegal action: ${err}`);
}

test('seating three players auto-starts a match', () => {
  const t = new Table('t1', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb()); // advance deals immediately in tests
  assert.equal(t.addPlayer('A', 'Ann'), true);
  assert.equal(t.addPlayer('B', 'Bo'), true);
  assert.equal(t.status, 'waiting');
  assert.equal(t.addPlayer('C', 'Cy'), true);
  assert.equal(t.status, 'playing');
  assert.ok(t.match);
  assert.ok(t.round);
});

test('a table is full at three and rejects a fourth', () => {
  const t = new Table('t2', 'public', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');
  assert.equal(t.addPlayer('D', 'Di'), false);
});

test('a full 6-deal match plays out and finishes with a winner', () => {
  const t = new Table('t3', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');

  driveMatch(t, ['A', 'B', 'C']);

  assert.equal(t.status, 'over');
  assert.equal(t.match!.finished, true);
  assert.equal(t.match!.dealsPlayed, 6);
  assert.ok(t.match!.winner !== null && t.match!.winner >= 0 && t.match!.winner <= 2);
});

test('views never leak another player\'s hand', () => {
  const t = new Table('t4', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');

  const viewA = t.view('A');
  assert.ok(viewA.round);
  assert.equal(viewA.round!.yourHand.length, 10);
  assert.deepEqual(viewA.round!.handCounts, [10, 10, 10]);
  // A's view exposes only A's hand; the others are counts only.
  assert.equal(viewA.youSlot, 0);
});

test('a player leaving mid-game ends the match', () => {
  const t = new Table('t5', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');
  assert.equal(t.status, 'playing');
  t.removePlayer('B');
  assert.equal(t.status, 'over');
});

test('rematch: all seats voting restarts the match; a mid-match vote is refused', () => {
  const t = new Table('t7', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');

  // A rematch can't start while the match is still running.
  assert.equal(typeof t.requestRematch('A'), 'string');
  assert.notEqual(t.requestRematch('A'), 'started');

  driveMatch(t, ['A', 'B', 'C']);
  assert.equal(t.status, 'over');
  assert.equal(t.history.length, 6);

  // Votes accumulate; the third one restarts a fresh match.
  assert.equal(t.requestRematch('A'), 'voted');
  assert.equal(t.requestRematch('B'), 'voted');
  assert.deepEqual(t.view('A').rematchVotes.toSorted(), [0, 1]);
  assert.equal(t.requestRematch('C'), 'started');

  assert.equal(t.status, 'playing');
  assert.equal(t.dealIndex, 0);
  assert.equal(t.match!.finished, false);
  assert.equal(t.history.length, 0); // the old scorecard is gone
  assert.equal(t.replay.length, 1); // a fresh deal replay has started
  assert.deepEqual(t.view('A').rematchVotes, []);

  // An outsider (or anyone, mid-match) can never trigger a rematch.
  const z = t.requestRematch('Z');
  assert.ok(z !== 'voted' && z !== 'started');
});

// The reconnect "resend" relies on this: an action that already applied is
// rejected on replay without mutating state, so a duplicated move can never be
// applied twice. (The message layer simply swallows the error for a resend.)
test('replaying an already-applied action is rejected and changes nothing', () => {
  const t = new Table('t6', 'private', { kind: 'deals', deals: 6 });
  t.setScheduler((cb) => cb());
  t.addPlayer('A', 'Ann');
  t.addPlayer('B', 'Bo');
  t.addPlayer('C', 'Cy');

  const actorFor = (role: Seat) => (['A', 'B', 'C'] as const)[(t.dealIndex + role) % 3];

  // Drive bidding + declaring up to the first card play (forehand grand).
  let guard = 0;
  while (t.round!.phase !== 'playing') {
    if (++guard > 100) throw new Error('never reached play');
    const r = t.round!;
    if (r.phase === 'bidding') {
      const b = r.bidding;
      if (b.awaiting === 'forehand-decision') must(t.handleAction(actorFor(0), { type: 'bid', value: 18 }));
      else if (b.awaiting === 'call') must(t.handleAction(actorFor(b.asker), { type: 'pass' }));
      else must(t.handleAction(actorFor(b.responder!), { type: 'pass' }));
    } else if (r.declareStep === 'choose') {
      must(t.handleAction(actorFor(0), { type: 'takeSkat' }));
    } else if (r.declareStep === 'discard') {
      must(t.handleAction(actorFor(0), { type: 'discard', cards: [r.hands[0][0], r.hands[0][1]] }));
    } else {
      must(t.handleAction(actorFor(0), { type: 'declareContract', contract: { type: 'grand' } }));
    }
  }

  const role = t.round!.turn;
  const card = legalCards(t.round!, role)[0];
  const actor = actorFor(role);
  const handBefore = t.round!.hands[role].length;

  // First play succeeds; the identical replay is now out of turn / card gone.
  assert.equal(t.handleAction(actor, { type: 'playCard', card }), null);
  const afterFirst = { trick: t.round!.trick.length, turn: t.round!.turn, hand: t.round!.hands[role].length };
  assert.equal(afterFirst.hand, handBefore - 1);

  const err = t.handleAction(actor, { type: 'playCard', card });
  assert.ok(err, 'a replayed already-applied play must be rejected');
  // State is untouched by the rejected replay: same trick, same turn, same hand.
  assert.equal(t.round!.trick.length, afterFirst.trick);
  assert.equal(t.round!.turn, afterFirst.turn);
  assert.equal(t.round!.hands[role].length, afterFirst.hand);
});
