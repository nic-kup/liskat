import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Seat } from '../src/types.ts';
import { createRound, applyAction, legalCards, type RoundState } from '../src/round.ts';
import { deal } from '../src/deal.ts';
import { decideBotAction } from '../src/bot.ts';
import { DEFAULT_PARAMS } from '../src/bot-params.ts';
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

test('bots declare disciplined games: high win rate, grand not over-played', () => {
  let declared = 0;
  let won = 0;
  let grand = 0;
  let suit = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = playOut(seed);
    if (r.passedIn || !r.result) continue;
    declared++;
    if (r.result.won) won++;
    if (r.contract!.type === 'grand') grand++;
    else if (r.contract!.type === 'suit') suit++;
  }
  assert.ok(declared > 50, `expected plenty of contested deals, got ${declared}`);
  // The weights are tuned for tournament profitability (a lost game costs ~2x a
  // won one), so the bot is disciplined: it should win a clear majority of what it
  // declares without being so picky it never bids. This is a sanity band, not a
  // target -- the evolution optimizes points, not win rate directly.
  const winRate = won / declared;
  assert.ok(winRate > 0.6 && winRate < 0.85, `declarer win rate out of band: ${won}/${declared} = ${winRate.toFixed(3)}`);
  // Grand should not dominate the mix; a grand needs real jack/ace power, so most
  // declared games are suit games (the old bot bid grand on nearly everything).
  assert.ok(grand < suit, `grand over-played: ${grand} grands vs ${suit} suit games`);
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

test('bidding weights are tunable: a high suit threshold makes a marginal hand pass', () => {
  // A pure suit hand: six spade trumps (only one jack, no club jack) and a single
  // side ace -- too little jack/ace power for a grand even with the skat bonus, and
  // too few top side cards for a hand game, so the suit threshold is the only lever.
  // The default weights bid it; cranking the suit threshold up makes the same hand
  // pass, proving the params actually drive the decision.
  const r = createRound({
    hands: [
      [c('SJ'), c('SA'), c('SK'), c('S10'), c('S9'), c('S8'), c('HA'), c('H9'), c('D8'), c('D7')],
      [c('HJ'), c('DJ'), c('CA'), c('CK'), c('C9'), c('CJ'), c('SQ'), c('HK'), c('HQ'), c('DA')],
      [c('CQ'), c('C10'), c('C8'), c('C7'), c('S7'), c('H10'), c('H8'), c('H7'), c('DK'), c('DQ')],
    ],
    skat: [c('D10'), c('D9')],
  });
  const def = decideBotAction(r, 0, DEFAULT_PARAMS);
  assert.ok(def && def.type !== 'pass', 'default weights should bid this hand');
  const picky = decideBotAction(r, 0, { ...DEFAULT_PARAMS, suitThreshold: 99 });
  assert.equal(picky!.type, 'pass', 'an unreachable suit threshold should force a pass');
});

test('passedPriorBonus: a marginal hand bids only once both opponents have passed', () => {
  // Forehand holds five plain spades (no jacks, no aces): a borderline spade game.
  const r0 = createRound({
    hands: [
      [c('SK'), c('SQ'), c('S9'), c('S8'), c('S7'), c('HK'), c('HQ'), c('DK'), c('DQ'), c('CK')],
      [c('SA'), c('S10'), c('SJ'), c('HA'), c('H10'), c('HJ'), c('H9'), c('DA'), c('D10'), c('DJ')],
      [c('H8'), c('H7'), c('D9'), c('D8'), c('D7'), c('CA'), c('C10'), c('CJ'), c('CQ'), c('C9')],
    ],
    skat: [c('C8'), c('C7')],
  });
  // Drive the auction until both opponents have passed and forehand may opt in.
  let r = applyAction(r0, { type: 'pass', seat: 1 });
  r = applyAction(r, { type: 'pass', seat: 2 });
  assert.equal(r.bidding.awaiting, 'forehand-decision');

  // Weights where the hand scores exactly 5 against a suit bar of 6: a pass.
  const base = {
    ...DEFAULT_PARAMS,
    suitTrump: 1, suitSideAce: 0, suitJack: 0, suitVoid: 0, suitTen: 0, suitThreshold: 6,
    grandThreshold: 99, // disable grand so only the suit decision matters
    skatBidBonus: 0, // isolate the passed-prior lever from the always-on skat bonus
    suitHandThreshold: 99, // and keep this borderline hand out of the hand-game path
  };
  assert.equal(decideBotAction(r, 0, { ...base, passedPriorBonus: 0 })!.type, 'pass', 'no bonus: marginal hand folds');
  assert.equal(decideBotAction(r, 0, { ...base, passedPriorBonus: 2 })!.type, 'bid', 'bonus: takes the free game');
});

test('skatBidBonus: relaxing the bar during the auction turns a pass into a bid', () => {
  // Forehand to open. A borderline hand scored on bare trump count: with the bar
  // set just above the hand's score it folds, but a skat bonus that closes the
  // gap makes it bid -- exactly the speculative-pickup behaviour.
  const r = createRound({
    hands: [
      [c('CJ'), c('SJ'), c('SA'), c('SK'), c('S9'), c('HK'), c('HQ'), c('H9'), c('D8'), c('D7')],
      [c('HJ'), c('DJ'), c('CA'), c('CK'), c('C9'), c('S10'), c('SQ'), c('S8'), c('HA'), c('DA')],
      [c('CQ'), c('C10'), c('C8'), c('C7'), c('S7'), c('H10'), c('H8'), c('H7'), c('DK'), c('DQ')],
    ],
    skat: [c('D10'), c('D9')],
  });
  // Score the hand on trumps alone (4: two jacks + S A,K... actually SA,SK,S9 are
  // trumps too) against a bar a touch above it; disable the other game types.
  const base = {
    ...DEFAULT_PARAMS,
    suitTrump: 1, suitSideAce: 0, suitJack: 0, suitVoid: 0, suitTen: 0, suitThreshold: 6,
    grandThreshold: 99, suitHandThreshold: 99, passedPriorBonus: 0,
  };
  assert.equal(decideBotAction(r, 0, { ...base, skatBidBonus: 0 })!.type, 'pass', 'no bonus: marginal hand folds');
  assert.notEqual(decideBotAction(r, 0, { ...base, skatBidBonus: 2 })!.type, 'pass', 'bonus: bids on the skat lift');
});

test('suitHandThreshold drives the hand-vs-skat choice on a top-heavy hand', () => {
  // A monster spade hand: five trumps (two jacks + three spades) and both red
  // aces with their tens -- a topRun of 4 in the side suits. At the default
  // threshold the bot declines the skat (plays a hand game); an unreachable
  // threshold forces it back to taking the skat.
  const hand = [c('CJ'), c('SJ'), c('SA'), c('S10'), c('SK'), c('HA'), c('H10'), c('DA'), c('D10'), c('CA')];
  // Opponents that cannot enter the auction: no aces but only five low cards each
  // (below the null bar) and too few trumps for a suit, so both pass and seat 0
  // wins uncontested -- isolating the declarer's hand-vs-skat choice.
  const mk = () =>
    createRound({
      hands: [
        hand,
        [c('HJ'), c('CK'), c('CQ'), c('C10'), c('SQ'), c('H9'), c('H8'), c('D9'), c('D8'), c('D7')],
        [c('DJ'), c('HK'), c('HQ'), c('DK'), c('DQ'), c('C9'), c('C8'), c('C7'), c('S9'), c('S8')],
      ],
      skat: [c('S7'), c('H7')],
    });
  // Drive the auction so seat 0 wins it cheaply, then reach the declarer's choose.
  // Grand is disabled so this ace-heavy hand commits to the spade game and the
  // hand-vs-skat choice is the only thing under test.
  function declareChoice(params: typeof DEFAULT_PARAMS) {
    let r = mk();
    let guard = 0;
    while (r.phase === 'bidding') {
      if (++guard > 50) throw new Error('auction stuck');
      const seat =
        r.bidding.awaiting === 'response' ? r.bidding.responder : r.bidding.asker;
      r = applyAction(r, decideBotAction(r, seat as Seat, params)!);
    }
    assert.equal(r.phase, 'declaring');
    assert.equal(r.declarer, 0);
    return decideBotAction(r, 0, params)!;
  }
  // Enable hand games explicitly (the shipped defaults keep them effectively off),
  // and disable grand so the spade game is the only thing in play.
  const handOn = { ...DEFAULT_PARAMS, grandThreshold: 99, suitHandTop: 1.25, suitHandTrumps: 1.07, suitHandThreshold: 9.75 };
  assert.equal(declareChoice(handOn).type, 'playHand', 'top-heavy hand plays closed');
  assert.equal(
    declareChoice({ ...handOn, suitHandThreshold: 99 }).type,
    'takeSkat',
    'an unreachable hand threshold forces taking the skat',
  );
});

test('a hand with no playable game passes the auction', () => {
  // No length, no jacks, no low cards anywhere: nothing this bot will bid.
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
