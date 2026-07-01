import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRound,
  applyAction,
  legalCards,
  decideBotAction,
  cardId,
  deal as dealCards,
  type RoundState,
  type Action,
  type Seat,
} from '@liskat/engine';
import { buildReviewDeal } from '../src/review.ts';
import type { DealReplay } from '../src/history.ts';

// Play a full deal with the bot in every seat and record it into a DealReplay the
// same way Table does (dealIndex 0, so slot === seat). Returns null if passed in.
function playAndRecord(seed: number): DealReplay {
  let rng = seed >>> 0;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let s: RoundState = createRound(dealCards(rand));
  const rep: DealReplay = {
    deal: 1,
    dealerSlot: 2,
    hands: [0, 1, 2].map((seat) => s.hands[seat].map(cardId)),
    skat: s.skat.map(cardId),
    bids: [],
    declarerSlot: null,
    tookSkat: false,
    discard: null,
    contract: null,
    tricks: [],
    result: null,
    passedIn: false,
    scores: [0, 0, 0],
  };

  const activeSeat = (): Seat | null => {
    if (s.phase === 'bidding') {
      const role = s.bidding.awaiting === 'response' ? s.bidding.responder : s.bidding.asker;
      return role;
    }
    if (s.phase === 'declaring') return s.declarer;
    if (s.phase === 'playing') return s.trickComplete ? null : s.turn;
    return null;
  };

  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 500) {
    if (s.phase === 'playing' && s.trickComplete) {
      // Record the completed trick, then collect.
      rep.tricks.push({
        leader: s.trick[0].seat,
        cards: s.trick.map((t) => cardId(t.card)),
        winner: s.trickWinnerSeat === null ? -1 : s.trickWinnerSeat,
      });
      s = applyAction(s, { type: 'collect' });
      continue;
    }
    const seat = activeSeat();
    if (seat === null) break;
    const action = decideBotAction(s, seat);
    if (!action) break;
    const bidBefore = s.bidding?.currentBid ?? 0;
    // Record bidding + declaring metadata like Table.recordAction does.
    if (action.type === 'bid') rep.bids.push({ slot: seat, kind: 'bid', value: action.value });
    else if (action.type === 'hold') rep.bids.push({ slot: seat, kind: 'hold', value: bidBefore });
    else if (action.type === 'pass') rep.bids.push({ slot: seat, kind: 'pass' });
    else if (action.type === 'takeSkat') rep.tookSkat = true;
    else if (action.type === 'playHand') rep.tookSkat = false;
    else if (action.type === 'discard') rep.discard = action.cards.map(cardId);
    s = applyAction(s, action);
    if (action.type === 'declareContract') {
      rep.contract = action.contract;
      rep.ouvert = !!action.announcements?.ouvert;
      rep.declarerSlot = s.declarer;
    }
  }
  rep.passedIn = s.passedIn;
  rep.result = s.result
    ? {
        won: s.result.won,
        value: s.result.value,
        schneider: s.result.schneider,
        schwarz: s.result.schwarz,
        cardPoints: s.result.cardPoints ?? null,
      }
    : null;
  return rep;
}

test('buildReviewDeal reconstructs plies matching the trick log', () => {
  let played = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rep = playAndRecord(seed);
    const review = buildReviewDeal(rep, 0);
    assert.equal(review.viewerSlot, 0);

    if (rep.passedIn) {
      assert.equal(review.plies.length, 0);
      continue;
    }
    played++;

    // One ply per card played, in play order.
    const flatCards = rep.tricks.flatMap((t) => t.cards);
    assert.equal(review.plies.length, flatCards.length, `seed ${seed}: ply count`);
    review.plies.forEach((p, i) => {
      assert.equal(p.card, flatCards[i], `seed ${seed}: ply ${i} card`);
      assert.ok(p.pos >= 0 && p.pos <= 2);
      assert.ok(p.slot >= 0 && p.slot <= 2);
    });
  }
  assert.ok(played > 0, 'at least one non-passed deal in the sample');
});

test('bestCard is a legal card, and forced plies omit it', () => {
  // Rebuild the same RoundState progression and cross-check each ply's bestCard
  // against the legal set at that moment.
  const rep = (() => {
    // find a non-passed deal
    for (let seed = 1; seed <= 200; seed++) {
      const r = playAndRecord(seed);
      if (!r.passedIn) return r;
    }
    throw new Error('no playable deal found');
  })();

  const review = buildReviewDeal(rep, 1);
  assert.equal(review.viewerSlot, 1);

  // Re-drive the deal to know the legal set at each ply.
  let rng = 999;
  void rng;
  let s: RoundState = createRound(dealCards(() => 0)); // placeholder, replaced below
  // Reconstruct exactly as buildReviewDeal does by replaying the recorded actions.
  const roleOfSlot = (slot: number): Seat => (((slot % 3) + 3) % 3) as Seat; // dealIndex 0
  const handsBySeat = [rep.hands[0], rep.hands[1], rep.hands[2]].map((h) =>
    h.map((id) => ({ suit: id[0], rank: id.slice(1) })),
  ) as any;
  s = createRound({ hands: handsBySeat, skat: rep.skat.map((id) => ({ suit: id[0], rank: id.slice(1) })) as any });
  for (const b of rep.bids) {
    const seat = roleOfSlot(b.slot);
    if (b.kind === 'bid') s = applyAction(s, { type: 'bid', seat, value: b.value! });
    else if (b.kind === 'hold') s = applyAction(s, { type: 'hold', seat });
    else s = applyAction(s, { type: 'pass', seat });
  }
  const declarer = roleOfSlot(rep.declarerSlot!);
  s = applyAction(s, { type: rep.tookSkat ? 'takeSkat' : 'playHand', seat: declarer });
  if (rep.tookSkat && rep.discard) {
    s = applyAction(s, {
      type: 'discard',
      seat: declarer,
      cards: rep.discard.map((id) => ({ suit: id[0], rank: id.slice(1) })) as any,
    });
  }
  const ann: any = {};
  if (rep.ouvert) {
    ann.ouvert = true;
    if (rep.contract!.type !== 'null' && !rep.tookSkat) {
      ann.schneiderAnnounced = true;
      ann.schwarzAnnounced = true;
    }
  }
  s = applyAction(s, { type: 'declareContract', seat: declarer, contract: rep.contract as any, announcements: ann });

  let sawForced = false;
  for (const ply of review.plies) {
    const seat = s.turn;
    const legal = legalCards(s, seat);
    const legalIds = new Set(legal.map(cardId));
    if (legal.length === 1) {
      assert.equal(ply.bestCard, undefined, `forced ply should omit bestCard (trick ${ply.trick})`);
      sawForced = true;
    } else {
      assert.ok(ply.bestCard, `multi-legal ply should have a bestCard (trick ${ply.trick})`);
      assert.ok(legalIds.has(ply.bestCard!), `bestCard ${ply.bestCard} must be legal`);
    }
    s = applyAction(s, { type: 'playCard', seat, card: { suit: ply.card[0], rank: ply.card.slice(1) } as any });
    if (s.trickComplete) s = applyAction(s, { type: 'collect' } as Action);
  }
  // The last card of the last trick is always forced; sanity that we exercised it.
  assert.ok(sawForced, 'expected at least one forced ply');
});
