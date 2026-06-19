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
