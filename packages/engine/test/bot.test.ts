import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Seat } from '../src/types.ts';
import { createRound, applyAction, legalCards, type RoundState } from '../src/round.ts';
import { deal } from '../src/deal.ts';
import { decideBotAction } from '../src/bot.ts';
import { cardsEqual } from '../src/cards.ts';

const c = (s: string): Card => ({ suit: s[0] as any, rank: s.slice(1) as any });

// A small deterministic RNG so the simulation is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Mirrors the server's notion of who must act right now (the trick-collect step
// is automatic, so it isn't a player decision).
function activeSeat(r: RoundState): Seat | null {
  if (r.phase === 'bidding') {
    const role = r.bidding.awaiting === 'response' ? r.bidding.responder : r.bidding.asker;
    return role;
  }
  if (r.phase === 'declaring') return r.declarer;
  if (r.phase === 'playing') return r.trickComplete ? null : r.turn;
  return null;
}

// Drives a full deal with the bot acting for every seat, collecting completed
// tricks automatically, until the round finishes.
function playOut(seed: number): RoundState {
  let r = createRound(deal(lcg(seed)));
  let guard = 0;
  while (r.phase !== 'finished') {
    if (++guard > 500) throw new Error('round did not terminate');
    if (r.phase === 'playing' && r.trickComplete) {
      r = applyAction(r, { type: 'collect' });
      continue;
    }
    const seat = activeSeat(r);
    assert.notEqual(seat, null, 'someone must be on turn');
    const action = decideBotAction(r, seat as Seat);
    assert.ok(action, 'bot must produce an action');
    r = applyAction(r, action!);
  }
  return r;
}

test('three bots play many full deals to completion without illegal moves', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = playOut(seed);
    assert.equal(r.phase, 'finished');
    // Either everyone passed, or a contract was played out to a scored result.
    if (!r.passedIn) {
      assert.ok(r.contract, 'a declared deal must have a contract');
      assert.ok(r.result, 'a declared deal must be scored');
      // All ten tricks were played (in a non-null game).
      if (r.contract!.type !== 'null') assert.equal(r.trickCount, 10);
    }
  }
});

test('bots win a fair share of the deals they declare', () => {
  let declared = 0;
  let won = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = playOut(seed);
    if (!r.passedIn && r.result) {
      declared++;
      if (r.result.won) won++;
    }
  }
  assert.ok(declared > 50, `expected plenty of contested deals, got ${declared}`);
  // A decent bot should make most of the games it chooses to declare.
  assert.ok(won / declared > 0.5, `declarer win rate too low: ${won}/${declared}`);
});

test('every card a bot plays is legal', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let r = createRound(deal(lcg(seed + 1000)));
    let guard = 0;
    while (r.phase !== 'finished') {
      if (++guard > 500) throw new Error('round did not terminate');
      if (r.phase === 'playing' && r.trickComplete) {
        r = applyAction(r, { type: 'collect' });
        continue;
      }
      const seat = activeSeat(r);
      const action = decideBotAction(r, seat as Seat)!;
      if (action.type === 'playCard') {
        const legal = legalCards(r, seat as Seat);
        assert.ok(legal.some((x) => cardsEqual(x, action.card)), `illegal card at seat ${seat}`);
      }
      r = applyAction(r, action);
    }
  }
});

test('a powerhouse hand (four jacks, two aces) bids', () => {
  const r = createRound({
    hands: [
      [c('CJ'), c('SJ'), c('HJ'), c('DJ'), c('CA'), c('SA'), c('D7'), c('D8'), c('H7'), c('H8')],
      [c('C7'), c('C8'), c('C9'), c('S7'), c('S8'), c('S9'), c('H9'), c('HK'), c('DK'), c('DQ')],
      [c('CK'), c('CQ'), c('C10'), c('SK'), c('SQ'), c('S10'), c('HA'), c('H10'), c('DA'), c('D10')],
    ],
    skat: [c('HQ'), c('D9')],
  });
  const action = decideBotAction(r, 0);
  assert.ok(action.type === 'hold' || action.type === 'bid', 'a powerhouse hand should not pass at 18');
});

test('a hand with no playable game passes the auction', () => {
  // No length, no jacks, no low cards anywhere — nothing this bot will bid.
  const r = createRound({
    hands: [
      [c('SK'), c('SQ'), c('S10'), c('HK'), c('HQ'), c('H10'), c('DK'), c('DQ'), c('D10'), c('CQ')],
      [c('CJ'), c('SJ'), c('HJ'), c('DJ'), c('CA'), c('SA'), c('HA'), c('DA'), c('CK'), c('C10')],
      [c('C7'), c('C8'), c('C9'), c('S7'), c('S8'), c('S9'), c('H7'), c('H8'), c('H9'), c('D7')],
    ],
    skat: [c('D8'), c('D9')],
  });
  const action = decideBotAction(r, 0);
  assert.equal(action.type, 'pass');
});
