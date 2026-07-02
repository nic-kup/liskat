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
import { baseValue, countMatadors, previewGameValue, type Announcements } from './scoring.ts';
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
// One determinized playout: `declSeat` declares `contract`, scored play for all seats.
// declSeat is the declarer's seat RELATIVE TO FOREHAND (who always leads, seat 0), so a
// non-forehand declarer correctly plays after the opening lead instead of always leading.
// Returns whether the declarer won AND the realized game value (schneider/schwarz baked
// in), so the EV can account for win/loss MAGNITUDE, not just win rate.
function playoutResult(d: Deal, contract: Contract, params: BotParams, hand = false, declSeat: Seat = 0): { won: boolean; value: number; schneider: boolean; schwarz: boolean } {
  let r = createRound(d);
  let guard = 0;
  // Rollouts play at mcRolloutTemp (default 0 = greedy): the shipped bot strips its tiny
  // playTemp for a low-variance EV estimate, while a tempered difficulty preset models all
  // three seats at its own temperature (see bot-params.ts). Either way the playout stays
  // deterministic: the softmax draw is hashed from the position, not a live RNG.
  const rolloutTemp = params.mcRolloutTemp ?? 0;
  const gp = (params.playTemp ?? 0) === rolloutTemp ? params : { ...params, playTemp: rolloutTemp };
  const step = (seat: Seat): Action | null => {
    if (r.phase === 'bidding') {
      // Only declSeat ever bids/holds; the other two always pass, so declSeat wins the
      // auction (at 18) from whichever seat it sits in.
      if (seat !== declSeat) return { type: 'pass', seat };
      const b = r.bidding;
      if (b.awaiting === 'response') return { type: 'hold', seat };
      return { type: 'bid', seat, value: 18 }; // asker or forehand-decision
    }
    if (r.phase === 'declaring') {
      // hand=true plays the deal CLOSED (declines the skat): the round skips the discard
      // step and the skat (still scored for the declarer) is never seen. Otherwise take it.
      if (r.declareStep === 'choose') return hand ? { type: 'playHand', seat: declSeat } : { type: 'takeSkat', seat: declSeat };
      if (r.declareStep === 'discard') {
        const scored = params.mcScoredDiscard && params.playW ? chooseDiscardScored(r.hands[declSeat], contract, params.playW) : null;
        return { type: 'discard', seat: declSeat, cards: scored ?? discardFor(r.hands[declSeat], contract) };
      }
      if (r.declareStep === 'contract') return { type: 'declareContract', seat: declSeat, contract };
      return null;
    }
    const legal = legalCards(r, seat);
    if (legal.length <= 1) return legal.length ? { type: 'playCard', seat, card: legal[0] } : null;
    return decideBotAction(r, seat, gp); // scored play at rolloutTemp (mcBidK irrelevant here)
  };
  while (r.phase !== 'finished') {
    if (++guard > 600) throw new Error('playout did not terminate');
    if (r.phase === 'playing' && r.trickComplete) { r = applyAction(r, { type: 'collect' }); continue; }
    const seat = active(r);
    if (seat === null) break;
    const a = step(seat) ?? step(declSeat);
    if (!a) throw new Error('no playout action');
    r = applyAction(r, a);
  }
  return {
    won: !!(r.result && r.result.won),
    value: r.result?.value ?? 0,
    schneider: !!r.result?.schneider,
    schwarz: !!r.result?.schwarz,
  };
}
// Thin wrapper for callers that only need the win/loss outcome.
function playoutWin(d: Deal, contract: Contract, params: BotParams): boolean {
  return playoutResult(d, contract, params).won;
}

interface PosGame { contract: Contract; value: number; ev: number; hand: boolean; ann?: Partial<Announcements> }
// contract = best-EV game; hand = whether that best game is played CLOSED (no skat); ann =
// the best schneider/schwarz announcement for that hand game (mcAnnounce; undefined = none);
// ceiling = its value (old behaviour: bid up to the best game); ceilingAny = highest value
// among ALL +EV games (bid up to the most valuable +EV game, since the bot is willing to
// PLAY any +EV game); posGames = every +EV game (hand games included when mcHandGame is on).
interface McResult { contract: Contract; hand: boolean; ann?: Partial<Announcements>; ceiling: number; ceilingAny: number; ev: number; posGames: PosGame[] }

// Pick the best schneider/schwarz announcement for a closed hand game from a rollout tally
// (m0 = matadors + game + hand multiplier base). Each rollout fell into one of four classes:
// lost (<61), won-bare (61-89), schneider (>=90, defenders took a trick), schwarz (defenders
// took no trick). Announcing raises the multiplier by +1 (schneider) / +2 (schwarz, implies
// schneider) but turns every under-delivering rollout into a LOSS at the higher value. Returns
// the announcement with the best mean signed value, or undefined when not announcing wins.
function bestAnnounce(base: number, m0: number, nLost: number, nWonBare: number, nSch: number, nSchw: number, K: number): Partial<Announcements> | undefined {
  const evNone = (-2 * base * m0 * nLost + base * m0 * nWonBare + base * (m0 + 1) * nSch + base * (m0 + 2) * nSchw) / K;
  const evSch = (-2 * base * (m0 + 1) * (nLost + nWonBare) + base * (m0 + 2) * nSch + base * (m0 + 3) * nSchw) / K;
  const evSchw = (-2 * base * (m0 + 2) * (nLost + nWonBare) - 2 * base * (m0 + 3) * nSch + base * (m0 + 4) * nSchw) / K;
  if (evSchw > evSch && evSchw > evNone) return { schneiderAnnounced: true, schwarzAnnounced: true };
  if (evSch > evNone) return { schneiderAnnounced: true };
  return undefined;
}
// Per-params memo, keyed by the params OBJECT (WeakMap) so it's valid for ANY weights, not
// just the shipped ones: a training genome or A/B variant is a distinct params object with
// its own cache that's GC'd when the genome is discarded. This lets the repeated same-hand
// evaluations within one auction (mcBidAction runs every bid step) hit the cache -- the
// dominant hot-loop cost -- instead of re-simulating from scratch each turn.
const memoByParams = new WeakMap<BotParams, Map<string, McResult>>();
function memoFor(params: BotParams): Map<string, McResult> {
  let m = memoByParams.get(params);
  if (!m) { m = new Map(); memoByParams.set(params, m); }
  return m;
}
// Build a 3-seat hand array with the declarer's cards at `declSeat` and the two opponent
// slices in the remaining seats (forehand-order), so forehand (seat 0) still leads.
function seatHands(hand0: Card[], oppA: Card[], oppB: Card[], declSeat: Seat): [Card[], Card[], Card[]] {
  const hands: [Card[], Card[], Card[]] = [[], [], []];
  hands[declSeat] = hand0.slice();
  const opp = [oppA, oppB];
  let oi = 0;
  for (let st = 0; st < 3; st++) if (st !== declSeat) hands[st] = opp[oi++];
  return hands;
}

// Estimate the best contract for a 10-card hand by simulated EV. EV (session points)
// = P(win)*value - P(loss)*2*value. `ceiling` is the value to bid up to (0 if no
// contract is +EV, so the bot passes).
export function mcEvaluateHand(hand0: Card[], params: BotParams = DEFAULT_PARAMS, declSeat: Seat = 0): McResult {
  const K = Math.max(1, params.mcBidK ?? 0);
  const memo = memoFor(params);
  const key = 'e' + declSeat + ':' + K + ':' + hand0.map(cardId).sort().join('');
  const hit = memo.get(key); if (hit) return hit;

  const known = new Set(hand0.map(cardId));
  const rest = DECK.filter((c) => !known.has(cardId(c)));
  let bestContract: Contract = CONTRACTS[0];
  let bestHand = false;
  let bestAnn: Partial<Announcements> | undefined;
  let bestEv = -Infinity;
  let bestValue = 0;
  let ceilingAny = 0;
  const posGames: PosGame[] = [];
  // mcHandGame: also evaluate playing each game CLOSED (hand). A hand game is just another
  // candidate -- it forgoes improving the hand with the skat but earns +1 multiplier, so it
  // wins the EV comparison only when the 10 cards are strong enough on their own. Off -> only
  // skat games (current behaviour exactly).
  const variants: boolean[] = params.mcHandGame ? [false, true] : [false];
  const valueOf = (c: Contract, h: boolean) =>
    c.type === 'null' ? previewGameValue(c, 0, h ? { hand: true } : {}) : previewGameValue(c, countMatadors(hand0, c), h ? { hand: true } : {});
  for (const contract of CONTRACTS) {
    // Common random numbers: re-seed per contract so EVERY contract is estimated on the SAME
    // sampled worlds. The cross-contract argmax is then a paired comparison, cutting the
    // selection noise that unpaired sampling adds at these small K.
    const rnd = lcg(seedOf(hand0));
    for (const isHand of variants) {
      // mcAnnounce: for a closed suit/grand hand game, reuse these rollouts to also pick the
      // best schneider/schwarz announcement (no extra sims) by tallying each rollout's realized
      // schneider/schwarz outcome.
      const announceable = !!params.mcAnnounce && isHand && contract.type !== 'null';
      let won = 0;
      let scoreSum = 0;
      let nLost = 0, nWonBare = 0, nSch = 0, nSchw = 0;
      for (let k = 0; k < K; k++) {
        const sh = shuffle(rest, rnd);
        const deal: Deal = { hands: seatHands(hand0, sh.slice(0, 10), sh.slice(10, 20), declSeat), skat: sh.slice(20, 22) as [Card, Card] };
        const res = playoutResult(deal, contract, params, isHand, declSeat);
        if (res.won) won++;
        scoreSum += res.won ? res.value : -2 * res.value;
        if (announceable) {
          if (!res.won) nLost++;
          else if (res.schwarz) nSchw++;
          else if (res.schneider) nSch++;
          else nWonBare++;
        }
      }
      const p = won / K;
      const value = valueOf(contract, isHand);
      // mcRichEV: mean realized signed value (schneider/schwarz included) instead of the
      // base-value win/loss EV. The ceiling stays at base value (the bid can't exceed it).
      const ev = params.mcRichEV ? scoreSum / K : p * value - (1 - p) * 2 * value;
      // Game SELECTION stays ranked on the non-announced ev (conservative -- a risky
      // announcement must never make a marginal hand game look better than a skat game). The
      // announcement is upside applied at declare time only when its rollout EV is the best.
      const ann = announceable ? bestAnnounce(baseValue(contract), countMatadors(hand0, contract) + 2, nLost, nWonBare, nSch, nSchw, K) : undefined;
      if (ev > bestEv) { bestEv = ev; bestContract = contract; bestValue = value; bestHand = isHand; bestAnn = ann; }
      if (ev > 0) { posGames.push({ contract, value, ev, hand: isHand, ann }); if (value > ceilingAny) ceilingAny = value; }
    }
  }
  const result: McResult = { contract: bestContract, hand: bestHand, ann: bestAnn, ceiling: bestEv > 0 ? bestValue : 0, ceilingAny, ev: bestEv, posGames };
  if (memo.size > 4096) memo.clear();
  memo.set(key, result);
  return result;
}

// Re-evaluate the contract AFTER taking the skat, with all 12 declarer cards known (only
// the 20 opponent cards are determinized). The bid-time estimate uses the original 10
// cards and so can be stale once the skat lands -- the two new cards can swing which game
// is best (e.g. a jack arriving makes grand the play). The scored discard is applied
// inside the playout, matching real play. 10 known cards go in the hand and 2 in the skat
// so the existing playout (which takes the skat, then discards) reconstitutes all 12.
export function mcEvaluateHand12(hand12: Card[], params: BotParams = DEFAULT_PARAMS, declSeat: Seat = 0): McResult {
  const K = Math.max(1, params.mcBidK ?? 0);
  const memo = memoFor(params);
  const key = 'e12:' + declSeat + ':' + K + ':' + hand12.map(cardId).sort().join('');
  const hit = memo.get(key); if (hit) return hit;

  const known = new Set(hand12.map(cardId));
  const rest = DECK.filter((c) => !known.has(cardId(c))); // the 20 opponent cards
  const h10 = hand12.slice(0, 10);
  const sk2 = hand12.slice(10, 12) as [Card, Card];
  let bestContract: Contract = CONTRACTS[0];
  let bestEv = -Infinity;
  let bestValue = 0;
  let ceilingAny = 0;
  const posGames: PosGame[] = [];
  for (const contract of CONTRACTS) {
    const rnd = lcg(seedOf(hand12)); // common random numbers across contracts (see mcEvaluateHand)
    let won = 0;
    let scoreSum = 0;
    for (let k = 0; k < K; k++) {
      const sh = shuffle(rest, rnd);
      const deal: Deal = { hands: seatHands(h10, sh.slice(0, 10), sh.slice(10, 20), declSeat), skat: sk2 };
      const res = playoutResult(deal, contract, params, false, declSeat);
      if (res.won) won++;
      scoreSum += res.won ? res.value : -2 * res.value;
    }
    const p = won / K;
    const value = contract.type === 'null' ? previewGameValue(contract, 0, {}) : previewGameValue(contract, countMatadors(hand12, contract), {});
    const ev = params.mcRichEV ? scoreSum / K : p * value - (1 - p) * 2 * value;
    if (ev > bestEv) { bestEv = ev; bestContract = contract; bestValue = value; }
    if (ev > 0) { posGames.push({ contract, value, ev, hand: false }); if (value > ceilingAny) ceilingAny = value; }
  }
  // hand:false throughout -- once the skat is taken, a closed hand game is no longer possible.
  const result: McResult = { contract: bestContract, hand: false, ceiling: bestEv > 0 ? bestValue : 0, ceilingAny, ev: bestEv, posGames };
  if (memo.size > 4096) memo.clear();
  memo.set(key, result);
  return result;
}

// Bidding via the MC ceiling (mirrors the formula bidder's auction logic, but the
// ceiling is the simulated best contract's value).
export function mcBidAction(s: RoundState, seat: Seat, p: BotParams): Action {
  const r = mcEvaluateHand(s.hands[seat], p, seat);
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

// The best +EV game that still covers the won bid, hand variants included. Mirrors the
// ceilingAny bidding logic so the declare matches what the auction committed to.
function bestCoveringPlan(ev: McResult, bid: number, hand10: Card[], anyEV: boolean): { contract: Contract; hand: boolean; ann?: Partial<Announcements> } {
  const gv = (c: Contract, h: boolean) =>
    c.type === 'null' ? previewGameValue(c, 0, h ? { hand: true } : {}) : previewGameValue(c, countMatadors(hand10, c), h ? { hand: true } : {});
  if (anyEV) {
    const covering = ev.posGames.filter((g) => gv(g.contract, g.hand) >= bid).sort((a, b) => b.ev - a.ev);
    if (covering.length) return { contract: covering[0].contract, hand: covering[0].hand, ann: covering[0].ann };
  }
  return { contract: ev.contract, hand: ev.hand, ann: ev.ann };
}

// Declaring. With mcHandGame, the 'choose' step compares the best skat-game EV against the
// best hand-game EV (both from the 10-card estimate) and plays the closed hand only when it
// wins -- so the bot bids/plays hand exactly when it's the most profitable +EV game, never to
// reach for a multiplier it can't make. Without the flag it always takes the skat (unchanged).
export function mcDeclareAction(s: RoundState, seat: Seat, p: BotParams): Action | null {
  const hand = s.hands[seat];

  if (s.declareStep === 'choose') {
    if (!p.mcHandGame) return { type: 'takeSkat', seat };
    const plan = bestCoveringPlan(mcEvaluateHand(hand, p, seat), s.bid, hand, !!p.mcAnyPositiveEV);
    return plan.hand ? { type: 'playHand', seat } : { type: 'takeSkat', seat };
  }

  // Hand game (we declined the skat at 'choose'): declare the best covering CLOSED game,
  // with the schneider/schwarz announcement the rollouts judged best (mcAnnounce).
  if (!s.tookSkat) {
    const ev = mcEvaluateHand(hand, p, seat);
    const gvh = (c: Contract) => (c.type === 'null' ? previewGameValue(c, 0, { hand: true }) : previewGameValue(c, countMatadors(hand, c), { hand: true }));
    const plan = bestCoveringPlan(ev, s.bid, hand, !!p.mcAnyPositiveEV);
    let contract = plan.contract;
    let ann = plan.ann;
    if (gvh(contract) < s.bid) {
      // Must still cover the bid as a hand game: take the cheapest covering closed game, and
      // drop any announcement (it was judged for a different game).
      let bestCover: { c: Contract; v: number } | null = null;
      for (const c of [{ type: 'grand' } as Contract, ...SUITS.map((su) => ({ type: 'suit', suit: su }) as Contract)]) {
        const v = gvh(c);
        if (v >= s.bid && (!bestCover || v < bestCover.v)) bestCover = { c, v };
      }
      if (bestCover) { contract = bestCover.c; ann = undefined; }
    }
    return { type: 'declareContract', seat, contract, announcements: ann };
  }

  // Skat game: hand is now 12 cards (original 10 ++ skat); slice(0,10) recovers the bid-time
  // hand, so the contract matches what the auction ceiling was based on.
  const orig = hand.length > 10 ? hand.slice(0, 10) : hand;
  // mcPostSkat: re-evaluate with the actual 12 cards (the skat may have changed the best
  // game); otherwise use the bid-time 10-card estimate.
  const ev = p.mcPostSkat && hand.length > 10 ? mcEvaluateHand12(hand, p, seat) : mcEvaluateHand(orig, p, seat);
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
