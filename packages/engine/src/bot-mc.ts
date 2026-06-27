// Monte-Carlo contract selection (bidding + declaring). Instead of scoring the hand
// with a linear formula and picking the highest game VALUE, the bot estimates each
// candidate contract's WIN RATE by sampling determinized worlds (the unknown 22 cards
// split randomly into the two opponents + skat) and playing each out with the scored
// play policy, then chooses the contract with the best expected points and bids up to
// its value. This fixes the "highest value beats best trump suit" flaw of the formula
// bidder (e.g. declaring a thin club game over a strong diamond one) and finds
// profitable grands/nulls the thresholds missed -- worth ~+5 pts/deal head-to-head.
//
// Determinization is seeded from the hand, so the bot is deterministic and
// reproducible. Sampling assumes opponents' hidden cards are uniform (nearly exact at
// bid time, before any card is seen) and that everyone plays the scored policy.

import type { Card, Contract, Rank, Seat } from './types.ts';
import { SUITS } from './types.ts';
import { createRound, applyAction, legalCards, type RoundState, type Action } from './round.ts';
import type { Deal } from './deal.ts';
import { cardId, cardPoints } from './cards.ts';
import { isTrump } from './ordering.ts';
import { chooseDiscardScored } from './bot-play-score.ts';
import { countMatadors, previewGameValue } from './scoring.ts';
import { nextBid } from './bidding.ts';
import { DEFAULT_PARAMS, type BotParams } from './bot-params.ts';
import { decideBotAction } from './bot.ts'; // runtime use only (inside playouts) -> safe circular import

const RANKS: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const DECK: Card[] = SUITS.flatMap((s) => RANKS.map((rank) => ({ suit: s, rank })));
const CONTRACTS: Contract[] = [...SUITS.map((s) => ({ type: 'suit', suit: s }) as Contract), { type: 'grand' }, { type: 'null' }];

// A small deterministic PRNG seeded from the hand, so the same hand always samples
// the same worlds (reproducible, testable, replay-safe).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}
function seedOf(hand: Card[]): number {
  let h = 2166136261;
  for (const id of hand.map(cardId).sort()) for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0);
  return h >>> 0;
}
function shuffle<T>(a: T[], rnd: () => number): T[] {
  const o = a.slice();
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
}

// Two cards to lay away: lowest-point non-trumps (never an ace) for suit/grand; the
// two highest for null. A placeholder discard, good enough to rank contracts.
function discardFor(hand12: Card[], contract: Contract): [Card, Card] {
  if (contract.type === 'null') {
    const h = [...hand12].sort((a, b) => RANKS.indexOf(b.rank) - RANKS.indexOf(a.rank));
    return [h[0], h[1]];
  }
  const cand = hand12.filter((c) => !isTrump(c, contract) && c.rank !== 'A');
  const pool = cand.length >= 2 ? cand : hand12.filter((c) => !isTrump(c, contract));
  const ranked = [...(pool.length >= 2 ? pool : hand12)].sort((a, b) => cardPoints(a) - cardPoints(b));
  return [ranked[0], ranked[1]];
}

function active(r: RoundState): Seat | null {
  if (r.phase === 'bidding') return r.bidding.awaiting === 'response' ? r.bidding.responder : r.bidding.asker;
  if (r.phase === 'declaring') return r.declarer;
  if (r.phase === 'playing') return r.trickComplete ? null : r.turn;
  return null;
}
// One determinized playout: seat 0 declares `contract`, scored play for all seats.
function playoutWin(d: Deal, contract: Contract, params: BotParams): boolean {
  let r = createRound(d);
  let guard = 0;
  const step = (seat: Seat): Action | null => {
    if (r.phase === 'bidding') {
      if (seat !== 0) return { type: 'pass', seat };
      const b = r.bidding;
      if (b.awaiting === 'forehand-decision') return { type: 'bid', seat: 0, value: 18 };
      if (b.awaiting === 'response') return { type: 'hold', seat: 0 };
      return { type: 'bid', seat: 0, value: 18 };
    }
    if (r.phase === 'declaring') {
      if (r.declareStep === 'choose') return { type: 'takeSkat', seat: 0 };
      if (r.declareStep === 'discard') {
        const scored = params.mcScoredDiscard && params.playW ? chooseDiscardScored(r.hands[0], contract, params.playW) : null;
        return { type: 'discard', seat: 0, cards: scored ?? discardFor(r.hands[0], contract) };
      }
      if (r.declareStep === 'contract') return { type: 'declareContract', seat: 0, contract };
      return null;
    }
    const legal = legalCards(r, seat);
    if (legal.length <= 1) return legal.length ? { type: 'playCard', seat, card: legal[0] } : null;
    return decideBotAction(r, seat, params); // scored play (mcBidK is irrelevant: only the playing phase is reached here)
  };
  while (r.phase !== 'finished') {
    if (++guard > 600) throw new Error('playout did not terminate');
    if (r.phase === 'playing' && r.trickComplete) { r = applyAction(r, { type: 'collect' }); continue; }
    const seat = active(r);
    if (seat === null) break;
    const a = step(seat) ?? step(0 as Seat);
    if (!a) throw new Error('no playout action');
    r = applyAction(r, a);
  }
  return !!(r.result && r.result.won);
}

interface PosGame { contract: Contract; value: number; ev: number }
// contract = best-EV game; ceiling = its value (old behaviour: bid up to the best game);
// ceilingAny = highest value among ALL +EV games (bid up to the most valuable +EV game,
// since the bot is willing to PLAY any +EV game); posGames = every +EV game.
interface McResult { contract: Contract; ceiling: number; ceilingAny: number; ev: number; posGames: PosGame[] }
const memo = new Map<string, McResult>();

// Estimate the best contract for a 10-card hand by simulated EV. EV (session points)
// = P(win)*value - P(loss)*2*value. `ceiling` is the value to bid up to (0 if no
// contract is +EV, so the bot passes).
export function mcEvaluateHand(hand0: Card[], params: BotParams = DEFAULT_PARAMS): McResult {
  const K = Math.max(1, params.mcBidK ?? 0);
  const cache = params === DEFAULT_PARAMS; // memo is keyed only by hand+K, valid when play params are the shipped ones
  const key = hand0.map(cardId).sort().join('') + ':' + K;
  if (cache) { const hit = memo.get(key); if (hit) return hit; }

  const rnd = lcg(seedOf(hand0));
  const known = new Set(hand0.map(cardId));
  const rest = DECK.filter((c) => !known.has(cardId(c)));
  let bestContract: Contract = CONTRACTS[0];
  let bestEv = -Infinity;
  let bestValue = 0;
  let ceilingAny = 0;
  const posGames: PosGame[] = [];
  for (const contract of CONTRACTS) {
    let won = 0;
    for (let k = 0; k < K; k++) {
      const sh = shuffle(rest, rnd);
      const deal: Deal = { hands: [hand0.slice(), sh.slice(0, 10), sh.slice(10, 20)], skat: sh.slice(20, 22) as [Card, Card] };
      if (playoutWin(deal, contract, params)) won++;
    }
    const p = won / K;
    const value = contract.type === 'null' ? previewGameValue(contract, 0, {}) : previewGameValue(contract, countMatadors(hand0, contract), {});
    const ev = p * value - (1 - p) * 2 * value;
    if (ev > bestEv) { bestEv = ev; bestContract = contract; bestValue = value; }
    if (ev > 0) { posGames.push({ contract, value, ev }); if (value > ceilingAny) ceilingAny = value; }
  }
  const result: McResult = { contract: bestContract, ceiling: bestEv > 0 ? bestValue : 0, ceilingAny, ev: bestEv, posGames };
  if (cache) { if (memo.size > 4096) memo.clear(); memo.set(key, result); }
  return result;
}

// Bidding via the MC ceiling (mirrors the formula bidder's auction logic, but the
// ceiling is the simulated best contract's value).
export function mcBidAction(s: RoundState, seat: Seat, p: BotParams): Action {
  const r = mcEvaluateHand(s.hands[seat], p);
  // With mcAnyPositiveEV the bot holds the auction up to the most valuable +EV game, not
  // just its single best game -- so a bid past the best game doesn't make it drop a game
  // it would still profitably play.
  const ceiling = p.mcAnyPositiveEV ? r.ceilingAny : r.ceiling;
  const b = s.bidding;
  if (b.awaiting === 'forehand-decision') return ceiling >= 18 ? { type: 'bid', seat, value: 18 } : { type: 'pass', seat };
  if (b.awaiting === 'response') return b.currentBid <= ceiling ? { type: 'hold', seat } : { type: 'pass', seat };
  const v = nextBid(b.currentBid);
  if (v !== null && v <= ceiling) return { type: 'bid', seat, value: v };
  return { type: 'pass', seat };
}

// Declaring: always take the skat, then declare the simulated best contract (with a
// guard so we never declare a contract worth less than the won bid), discarding for it.
export function mcDeclareAction(s: RoundState, seat: Seat, p: BotParams): Action | null {
  if (s.declareStep === 'choose') return { type: 'takeSkat', seat };
  // hand is now 12 cards (original 10 ++ skat); slice(0,10) recovers the bid-time hand,
  // so the contract matches what the auction ceiling was based on.
  const hand = s.hands[seat];
  const orig = hand.length > 10 ? hand.slice(0, 10) : hand;
  const ev = mcEvaluateHand(orig, p);
  let contract = ev.contract;
  // Safety: the declared contract must cover the won bid (value uses the full 12 cards).
  const gv = (c: Contract) => (c.type === 'null' ? previewGameValue(c, 0, {}) : previewGameValue(c, countMatadors(hand, c), {}));
  // If the auction was pushed past the best game, declare the highest-EV +EV game that
  // still covers the won bid (matching the ceilingAny bidding logic above).
  if (p.mcAnyPositiveEV) {
    const covering = ev.posGames.filter((g) => gv(g.contract) >= s.bid).sort((a, b) => b.ev - a.ev);
    if (covering.length) contract = covering[0].contract;
  }
  if (gv(contract) < s.bid) {
    let bestCover: { c: Contract; v: number } | null = null;
    for (const c of [{ type: 'grand' } as Contract, ...SUITS.map((su) => ({ type: 'suit', suit: su }) as Contract)]) {
      const v = gv(c);
      if (v >= s.bid && (!bestCover || v < bestCover.v)) bestCover = { c, v };
    }
    if (bestCover) contract = bestCover.c;
  }
  if (s.declareStep === 'discard') {
    const scored = p.scorePlay && p.scorePlay > 0.5 && p.playW ? chooseDiscardScored(hand, contract, p.playW) : null;
    return { type: 'discard', seat, cards: scored ?? discardFor(hand, contract) };
  }
  if (s.declareStep === 'contract') return { type: 'declareContract', seat, contract };
  return null;
}
