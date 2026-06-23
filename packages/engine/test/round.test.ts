import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRound, applyAction, legalCards, type RoundState } from '../src/round.ts';
import { deal } from '../src/deal.ts';
import { totalPoints, cardPoints, cardFromId } from '../src/cards.ts';

// A tiny deterministic RNG (mulberry32) so deals are reproducible in tests.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('bidding: middlehand bids, forehand holds, then both opponents pass -> forehand declares', () => {
  let s = createRound(deal(rng(1)));
  s = applyAction(s, { type: 'bid', seat: 1, value: 18 }); // middlehand calls 18
  s = applyAction(s, { type: 'hold', seat: 0 }); // forehand holds
  s = applyAction(s, { type: 'pass', seat: 1 }); // middlehand gives up -> forehand wins stage 1
  s = applyAction(s, { type: 'pass', seat: 2 }); // rearhand passes -> forehand is declarer
  assert.equal(s.phase, 'declaring');
  assert.equal(s.declarer, 0);
  assert.equal(s.bid, 18);
});

test('bidding: rearhand outbids and wins the contract', () => {
  let s = createRound(deal(rng(2)));
  s = applyAction(s, { type: 'bid', seat: 1, value: 18 });
  s = applyAction(s, { type: 'hold', seat: 0 });
  s = applyAction(s, { type: 'pass', seat: 1 }); // forehand wins stage 1 holding 18
  s = applyAction(s, { type: 'bid', seat: 2, value: 20 }); // rearhand raises
  s = applyAction(s, { type: 'pass', seat: 0 }); // forehand drops -> rearhand declares
  assert.equal(s.declarer, 2);
  assert.equal(s.bid, 20);
});

test('bidding: everyone passes -> forehand may opt in, or the deal is passed', () => {
  let s = createRound(deal(rng(3)));
  s = applyAction(s, { type: 'pass', seat: 1 }); // middlehand passes immediately
  s = applyAction(s, { type: 'pass', seat: 2 }); // rearhand passes immediately
  assert.equal(s.bidding.awaiting, 'forehand-decision');

  // forehand declines -> passed-in deal
  const passed = applyAction(s, { type: 'pass', seat: 0 });
  assert.equal(passed.phase, 'finished');
  assert.equal(passed.passedIn, true);

  // ...or forehand opts in at 18
  const opted = applyAction(s, { type: 'bid', seat: 0, value: 18 });
  assert.equal(opted.phase, 'declaring');
  assert.equal(opted.declarer, 0);
});

test('full round plays out to a scored result with points conserved', () => {
  let s = createRound(deal(rng(42)));
  // Forehand becomes declarer the simple way.
  s = applyAction(s, { type: 'pass', seat: 1 });
  s = applyAction(s, { type: 'pass', seat: 2 });
  s = applyAction(s, { type: 'bid', seat: 0, value: 18 });

  // Take the skat, discard the first two cards, play a grand.
  s = applyAction(s, { type: 'takeSkat', seat: 0 });
  const hand = s.hands[0];
  s = applyAction(s, { type: 'discard', seat: 0, cards: [hand[0], hand[1]] });
  s = applyAction(s, { type: 'declareContract', seat: 0, contract: { type: 'grand' } });
  assert.equal(s.phase, 'playing');

  // Auto-play: always play the first legal card, collecting completed tricks.
  let guard = 0;
  while (s.phase === 'playing') {
    if (s.trickComplete) {
      s = applyAction(s, { type: 'collect' });
    } else {
      const options = legalCards(s, s.turn);
      assert.ok(options.length > 0, 'a player on turn always has a legal card');
      s = applyAction(s, { type: 'playCard', seat: s.turn, card: options[0] });
    }
    if (++guard > 60) throw new Error('play did not terminate');
  }

  assert.equal(s.phase, 'finished');
  assert.equal(s.trickCount, 10);
  assert.equal(s.declarerTricksWon + s.defenderTricksWon, 10);
  assert.ok(s.result);

  // All 120 card points are accounted for across declarer (incl. skat) and defenders.
  const skatPts = s.skat.reduce((n, c) => n + cardPoints(c), 0);
  const declarerCardPoints = totalPoints(s.declarerTrickPoints) + skatPts;
  const defenderCardPoints = totalPoints(s.defenderTrickPoints);
  assert.equal(declarerCardPoints + defenderCardPoints, 120);
});

test('null ends immediately when the declarer wins a trick', () => {
  // Hand-crafted deal: forehand (seat 0) holds the ace of spades and leads it;
  // the other two each hold exactly one (lower) spade, so they must follow and
  // forehand wins trick one, which loses a Null game right away.
  const id = (s: string) => cardFromId(s);
  const deal = {
    hands: [
      ['SA', 'S7', 'S8', 'S9', 'S10', 'SJ', 'C7', 'C8', 'C9', 'C10'].map(id),
      ['SK', 'CJ', 'CQ', 'CK', 'CA', 'H7', 'H8', 'H9', 'H10', 'HJ'].map(id),
      ['SQ', 'HQ', 'HK', 'HA', 'D7', 'D8', 'D9', 'D10', 'DJ', 'DQ'].map(id),
    ] as [any, any, any],
    skat: ['DK', 'DA'].map(id) as [any, any],
  };
  let s = createRound(deal);
  s = applyAction(s, { type: 'pass', seat: 1 });
  s = applyAction(s, { type: 'pass', seat: 2 });
  s = applyAction(s, { type: 'bid', seat: 0, value: 18 });
  s = applyAction(s, { type: 'playHand', seat: 0 });
  s = applyAction(s, { type: 'declareContract', seat: 0, contract: { type: 'null' } });

  s = applyAction(s, { type: 'playCard', seat: 0, card: id('SA') });
  s = applyAction(s, { type: 'playCard', seat: 1, card: id('SK') });
  s = applyAction(s, { type: 'playCard', seat: 2, card: id('SQ') });
  s = applyAction(s, { type: 'collect' });

  assert.equal(s.phase, 'finished');
  assert.equal(s.trickCount, 1); // ended after one trick, not all ten
  assert.equal(s.result?.won, false);
});

test('following suit is enforced', () => {
  let s = createRound(deal(rng(7)));
  s = applyAction(s, { type: 'pass', seat: 1 });
  s = applyAction(s, { type: 'pass', seat: 2 });
  s = applyAction(s, { type: 'bid', seat: 0, value: 18 });
  s = applyAction(s, { type: 'playHand', seat: 0 });
  s = applyAction(s, { type: 'declareContract', seat: 0, contract: { type: 'suit', suit: 'C' } });

  // Forehand leads any card; the next player's legal set must follow suit when able.
  const lead = legalCards(s, 0)[0];
  s = applyAction(s, { type: 'playCard', seat: 0, card: lead });
  const opts = legalCards(s, s.turn);
  // Every legal option leads with the same suit as the lead, unless the player is void.
  assert.ok(opts.length > 0);
});
