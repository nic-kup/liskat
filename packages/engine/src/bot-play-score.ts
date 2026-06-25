// An alternative card-play brain: instead of the branchy heuristic in bot.ts
// (lead/follow × declarer/defender special cases), this scores EVERY legal card
// with a linear model over a fixed feature vector and plays the highest-scoring
// one. The weights are learnable (experiments/evolve-play.ts) and there are four
// independent sets, because the four play roles want opposite things:
//
//   * suit/grand DECLARER  — pull trumps, cash masters, hoard points
//   * suit/grand DEFENDER  — duck, schmier the partner, deny the declarer points
//   * NULL DECLARER        — lose every trick (never win)
//   * NULL DEFENDER        — force the declarer to win (don't grab tricks yourself)
//
// Every feature is computed from PUBLIC information only (the cards on the table,
// the play record digested into PlayMemory, plus the bot's own hand) -- exactly
// what the existing heuristic bot may look at. No peeking at hidden hands.
//
// A feature is a function of (candidate card, situation). For the linear argmax
// to actually use a feature it must VARY across the candidate cards in a given
// decision -- a feature constant across all candidates shifts every score equally
// and cannot change which card wins. So every feature below is a per-card
// property (its points, strength, whether it would win the trick, ...), some of
// them gated by a situation indicator (am I leading? am I last? is the next
// player able to ruff?). Situation-only quantities (trick value, my position)
// enter only multiplied into a per-card property.

import type { Card, Contract, Seat } from './types.ts';
import { cardPoints, totalPoints } from './cards.ts';
import { isTrump, leadSuit, trickWinner } from './ordering.ts';
import { buildMemory, isCategoryMaster, outstandingTrumps, type PlayMemory } from './bot-memory.ts';
import type { RoundState } from './round.ts';

// ---- the learnable weights -------------------------------------------------

// Four weight vectors, one per play role. suit* are length SUIT_FEATURES.length,
// null* are length NULL_FEATURES.length. Carried inside BotParams as playW.
export interface PlayWeights {
  suitDecl: number[];
  suitDef: number[];
  nullDecl: number[];
  nullDef: number[];
}

// Feature names double as documentation and fix the vector order. SUIT_FEATURES
// applies to suit AND grand games (they share a trump structure); NULL_FEATURES
// to null games.
export const SUIT_FEATURES = [
  'lead_str', // leading: trick-strength of the card (low = duck a loser, high = cash)
  'lead_pts', // leading: point value of the card
  'lead_trump', // leading: is a trump (general taste for opening trumps)
  'lead_trump_pull', // leading: a trump WHILE opponents still hold trumps (pull-trumps signal)
  'lead_master', // leading: card is the master of its category (cash it)
  'lead_master_safe', // leading: a master no waiting opponent can ruff (safe to cash)
  'lead_len', // leading: how many of this card's suit we still hold (lead long vs short)
  'lead_ruffrisk', // leading: a side card a waiting opponent could ruff (risky to open)
  'win', // following: this card would take the trick
  'win_val', // following+win: points captured (trick so far + this card)
  'win_str', // following+win: strength spent to win (prefer winning cheaply -> negative)
  'win_ruff', // following+win: winning by ruffing a side-suit lead
  'win_last', // following+win: winning as the last player (safe, no over-ruff)
  'lose_pts', // following+lose: points on the card we surrender
  'lose_str', // following+lose: strength of the card we throw (dump high vs low)
  'lose_len', // following+lose: suit length of the card thrown
  'lose_trump', // following+lose: throwing a trump away uselessly (usually bad)
  'friend_pts', // following+last: ally winning and we play last -> points we safely hand them (schmier)
  'opp_pts', // following+lose: opponent currently winning -> points we feed them
  'follow_ruffrisk', // following+lose: a waiting opponent can ruff the led suit anyway
  // --- situational features (added iteration 3) ---
  'lead_partner_ruff', // leading: a side suit my PARTNER (still to play) can ruff -> a trick for our side
  'win_clinch', // following+win: taking this trick reaches my side's point goal (declarer 61 / defender 60)
  'win_press', // following+win: my side already past its goal -> extra captured points (declarer schneider press)
  'lead_trump_pull_graded', // leading: a trump, scaled by how many opponent trumps are still out (graded pull)
  // --- split features (iteration 4): lead_len's weight was huge and opposite-signed
  //     by role, conflating long-in-trump with long-in-a-side-suit; win_ruff was huge
  //     for defenders. Split each by an interaction so the model can value them apart.
  'lead_len_trump', // leading: trump-suit length (lead long from trumps -> pull power)
  'lead_len_side', // leading: side-suit length (lead long from a side suit -> establish it)
  'win_ruff_last', // following+win: ruffing a side lead AS the last player (safe, no over-ruff)
] as const;

export const NULL_FEATURES = [
  'nlead_rank', // leading: null-rank of the card (7 low .. A high)
  'nlead_len', // leading: suit length of the card
  'nlead_declvoid', // leading: declarer is void in this suit (defender: avoid; can't be trapped there)
  'nfollow_win', // following: this card would WIN the trick
  'nfollow_rank', // following: null-rank of the card
  'nfollow_voidrank', // following+void-in-led: rank of the card we discard
  'nfollow_voidlen', // following+void-in-led: suit length of the card we discard
] as const;

export const SUIT_NF = SUIT_FEATURES.length;
export const NULL_NF = NULL_FEATURES.length;

// ---- per-card scalar helpers -----------------------------------------------

// Trick-strength of a card, normalised to roughly [0,1] and MONOTONIC with the
// engine's real trick ordering: side cards < non-jack trumps < jacks. Only the
// ordering matters (the model compares strengths), not the exact spacing.
const SIDE_ASC: Card['rank'][] = ['7', '8', '9', 'Q', 'K', '10', 'A'];
const NULL_ASC: Card['rank'][] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const JACK_RANK: Record<string, number> = { C: 4, S: 3, H: 2, D: 1 };
function str01(c: Card, contract: Contract): number {
  if (isTrump(c, contract)) {
    if (c.rank === 'J') return 0.8 + (JACK_RANK[c.suit] / 4) * 0.2; // 0.85 .. 1.0
    return 0.55 + (SIDE_ASC.indexOf(c.rank) / 6) * 0.2; // 0.55 .. 0.75
  }
  return (SIDE_ASC.indexOf(c.rank) / 6) * 0.5; // 0 .. 0.5
}
const pts01 = (c: Card) => cardPoints(c) / 11;
const nullRank01 = (c: Card) => NULL_ASC.indexOf(c.rank) / 7;

function suitLen01(c: Card, hand: Card[], contract: Contract): number {
  const cat = leadSuit(c, contract);
  let n = 0;
  for (const h of hand) if (leadSuit(h, contract) === cat) n++;
  return n / 8;
}

// Would playing `card` win the trick as it stands?
function wouldWin(trickCards: Card[], card: Card, contract: Contract): boolean {
  if (trickCards.length === 0) return true; // leading: trivially "ahead"
  return trickWinner([...trickCards, card], contract) === trickCards.length;
}

// ---- situation context (computed once per decision) ------------------------

interface Ctx {
  contract: Contract;
  hand: Card[];
  mem: PlayMemory;
  trickCards: Card[];
  empty: boolean;
  isLast: boolean; // I am the third (last) to play this trick
  led: ReturnType<typeof leadSuit> | null;
  trickValue: number; // points already in the trick
  iAmDeclarer: boolean;
  declarer: Seat | null;
  // Seats that still play AFTER me this trick and are my OPPONENTS (the players
  // who could beat / ruff what I play). Declarer's opponents are both defenders;
  // a defender's only dangerous waiting opponent is the declarer.
  waitingOpps: Seat[];
  waitingPartners: Seat[]; // ally seats that still play after me this trick (a defender's partner)
  oppTrumpsOut: number;
  friendWinning: boolean; // the current trick winner is my ally (defender's partner)
  oppWinning: boolean; // the current trick winner is an opponent
  myBanked: number; // points my side has already secured this deal
  myGoal: number; // points my side needs to win the card play (declarer 61, defenders 60)
}

function buildCtx(s: RoundState, seat: Seat): Ctx {
  const contract = s.contract!;
  const hand = s.hands[seat];
  const mem = buildMemory(s, contract);
  const trickCards = s.trick.map((t) => t.card);
  const empty = trickCards.length === 0;
  const isLast = s.trick.length === 2;
  const led = empty ? null : leadSuit(trickCards[0], contract);
  const iAmDeclarer = s.declarer === seat;

  // Trumps still possibly in opponents' hands.
  const oppTrumpsOut = outstandingTrumps(hand, mem, contract, iAmDeclarer ? s.skat : []).length;

  // Who is winning the trick right now, and is that an ally or an opponent.
  let friendWinning = false;
  let oppWinning = false;
  if (!empty) {
    const wSeat = s.trick[trickWinner(trickCards, contract)].seat;
    if (iAmDeclarer) oppWinning = true; // only defenders can be ahead of the declarer
    else if (wSeat === s.declarer) oppWinning = true;
    else friendWinning = true; // the other defender (our partner) leads the trick
  }

  // Seats that still act after me this trick.
  const played = new Set(s.trick.map((t) => t.seat));
  const waiting: Seat[] = [];
  for (let k = 1; k <= 2; k++) {
    const nxt = (((seat + k) % 3) + 3) % 3 as Seat;
    if (!played.has(nxt) && nxt !== seat) waiting.push(nxt);
  }
  // Split the waiting seats into opponents and allies (relative to my side).
  const isOpp = (o: Seat) => (iAmDeclarer ? o !== s.declarer : o === s.declarer);
  const waitingOpps = waiting.filter(isOpp);
  const waitingPartners = waiting.filter((o) => !isOpp(o)); // a defender's still-to-play partner

  // Points my side has banked, and the goal it needs. The declarer knows the skat
  // (it counts for them); defenders know their own collected pile. Both are public
  // to my side -- no peeking at hidden hands.
  const myBanked = iAmDeclarer
    ? totalPoints(s.declarerTrickPoints) + totalPoints(s.skat)
    : totalPoints(s.defenderTrickPoints);
  const myGoal = iAmDeclarer ? 61 : 60;

  return {
    contract, hand, mem, trickCards, empty, isLast, led,
    trickValue: trickCards.reduce((a, c) => a + cardPoints(c), 0),
    iAmDeclarer, declarer: s.declarer, waitingOpps, waitingPartners, oppTrumpsOut, friendWinning, oppWinning,
    myBanked, myGoal,
  };
}

// Can a waiting opponent ruff side suit `suit`? True if one of them is void in it
// and not known out of trumps, and trumps are still out at all.
function waitingCanRuff(suit: string, ctx: Ctx): boolean {
  if (ctx.oppTrumpsOut <= 0) return false;
  return ctx.waitingOpps.some((o) => ctx.mem.voids[o].has(suit as any) && !ctx.mem.voids[o].has('T'));
}

// Can my still-to-play PARTNER (a defender's ally) ruff side suit `suit`? If so,
// leading it lets my side win the trick by ruff. Mirrors waitingCanRuff for allies.
function partnerCanRuff(suit: string, ctx: Ctx): boolean {
  if (ctx.oppTrumpsOut <= 0) return false; // (a coarse proxy: some trump exists out there)
  return ctx.waitingPartners.some((o) => ctx.mem.voids[o].has(suit as any) && !ctx.mem.voids[o].has('T'));
}

// ---- feature extraction ----------------------------------------------------

// Feature vector for a suit/grand candidate card. Order matches SUIT_FEATURES.
function suitFeatures(c: Card, ctx: Ctx): number[] {
  const { contract, hand, empty, isLast, led } = ctx;
  const trump = isTrump(c, contract) ? 1 : 0;
  const sc = str01(c, contract);
  const pt = pts01(c);
  const len = suitLen01(c, hand, contract);
  const master = isCategoryMaster(c, hand, ctx.mem, contract) ? 1 : 0;
  const win = empty ? 0 : wouldWin(ctx.trickCards, c, contract) ? 1 : 0;
  const lose = empty ? 0 : 1 - win;
  const ruffSide = led !== null && led !== 'T' ? 1 : 0; // the lead is a side suit (ruffable)
  const capt01 = (ctx.trickValue + cardPoints(c)) / 33;

  // Captured points if I win this trick, and whether that crosses my side's goal.
  const captPoints = ctx.trickValue + cardPoints(c);
  const clinch = ctx.myBanked < ctx.myGoal && ctx.myBanked + captPoints >= ctx.myGoal ? 1 : 0;
  const pastGoal = ctx.myBanked >= ctx.myGoal ? 1 : 0;

  const f = new Array<number>(SUIT_NF).fill(0);
  if (empty) {
    f[0] = sc;
    f[1] = pt;
    f[2] = trump;
    f[3] = trump && ctx.oppTrumpsOut > 0 ? 1 : 0;
    f[4] = master;
    f[5] = master && !waitingCanRuff(c.suit, ctx) ? 1 : 0;
    f[6] = len;
    f[7] = !trump && waitingCanRuff(c.suit, ctx) ? 1 : 0;
    f[20] = !trump && partnerCanRuff(c.suit, ctx) ? 1 : 0; // lead into my partner's ruff
    f[23] = trump ? Math.min(ctx.oppTrumpsOut, 6) / 6 : 0; // graded trump pull
    f[24] = trump ? len : 0; // split of lead_len: trump-suit length
    f[25] = !trump ? len : 0; // split of lead_len: side-suit length
  } else {
    f[8] = win;
    f[9] = win * capt01;
    f[10] = win * sc;
    f[11] = win * trump * ruffSide;
    f[12] = win * (isLast ? 1 : 0);
    f[13] = lose * pt;
    f[14] = lose * sc;
    f[15] = lose * len;
    f[16] = lose * trump;
    f[17] = ctx.friendWinning && isLast ? pt : 0; // safe schmier: ally winning and nobody plays after us
    f[18] = lose * (ctx.oppWinning ? 1 : 0) * pt;
    f[19] = lose * ruffSide * (led !== null && waitingCanRuff(led as string, ctx) ? 1 : 0);
    f[21] = win * clinch; // taking this trick reaches my side's point goal
    f[22] = win * capt01 * pastGoal; // already safe -> press for more points (schneider)
    f[26] = win * trump * ruffSide * (isLast ? 1 : 0); // split of win_ruff: ruff as the last player
  }
  return f;
}

// Feature vector for a null candidate card. Order matches NULL_FEATURES.
function nullFeatures(c: Card, ctx: Ctx): number[] {
  const { contract, hand, empty, led } = ctx;
  const rank = nullRank01(c);
  const len = suitLen01(c, hand, contract);
  const win = empty ? 0 : wouldWin(ctx.trickCards, c, contract) ? 1 : 0;
  // Void in the led suit means we are free to discard anything (we couldn't follow).
  const voidInLed = !empty && led !== null && c.suit !== led && leadSuit(c, contract) !== led ? 1 : 0;
  // Declarer void in this card's suit (defender perspective; from public voids).
  const declVoid = ctx.declarer !== null && ctx.mem.voids[ctx.declarer].has(c.suit as any) ? 1 : 0;

  const f = new Array<number>(NULL_NF).fill(0);
  if (empty) {
    f[0] = rank;
    f[1] = len;
    f[2] = declVoid;
  } else {
    f[3] = win;
    f[4] = rank;
    f[5] = voidInLed * rank;
    f[6] = voidInLed * len;
  }
  return f;
}

// ---- the public entry point ------------------------------------------------

function dot(f: number[], w: number[]): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * (w[i] ?? 0);
  return s;
}

// Choose a card from `legal` by linear scoring with the role's weight vector.
// Ties (equal score) resolve to the FIRST legal card, which `legalCards` returns
// in a stable hand order, so play is deterministic.
export function chooseCardScored(s: RoundState, seat: Seat, legal: Card[], w: PlayWeights): Card {
  const ctx = buildCtx(s, seat);
  const isNull = ctx.contract.type === 'null';
  const weights = isNull ? (ctx.iAmDeclarer ? w.nullDecl : w.nullDef) : ctx.iAmDeclarer ? w.suitDecl : w.suitDef;
  const feats = isNull ? nullFeatures : suitFeatures;

  let best = legal[0];
  let bestScore = -Infinity;
  for (const c of legal) {
    const sc = dot(feats(c, ctx), weights);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return best;
}

// A hand-tuned starting point: encodes ordinary club-level play so the model is
// sane before any evolution (and serves as one GA anchor). Suit/grand: lead low,
// pull trumps while they're out, cash safe masters, win cheaply, don't feed
// opponents points, schmier the partner. Null declarer: never win, play high
// when safe to shed; null defender: don't grab tricks, keep low cards back.
export function defaultPlayWeights(): PlayWeights {
  const suitDecl = new Array<number>(SUIT_NF).fill(0);
  suitDecl[0] = -0.6; // lead low
  suitDecl[3] = 1.2; // pull trumps while out
  suitDecl[4] = 0.8; // cash masters
  suitDecl[5] = 0.6; // ...especially safe ones
  suitDecl[7] = -0.8; // avoid opening a ruffable suit
  suitDecl[8] = 1.0; // win the trick
  suitDecl[9] = 1.5; // ...more when it's valuable
  suitDecl[10] = -0.8; // ...but cheaply
  suitDecl[12] = 0.5; // safe to win last
  suitDecl[13] = -0.4; // don't dump points on a loser
  suitDecl[16] = -1.0; // never waste a trump
  suitDecl[21] = 1.5; // grab the trick that clinches 61
  suitDecl[22] = 0.4; // once safe, press for schneider
  suitDecl[23] = 0.8; // graded trump pull

  const suitDef = new Array<number>(SUIT_NF).fill(0);
  suitDef[0] = -0.6; // lead low
  suitDef[7] = -0.8; // avoid a ruffable lead
  suitDef[8] = 0.7; // overtake the declarer
  suitDef[9] = 1.3;
  suitDef[10] = -0.8;
  suitDef[12] = 0.5;
  suitDef[16] = -1.0;
  suitDef[17] = 1.2; // schmier the partner generously
  suitDef[18] = -1.2; // never feed the declarer points
  suitDef[20] = 1.0; // lead into the partner's ruff
  suitDef[21] = 1.5; // grab the trick that secures 60 for the defence

  const nullDecl = new Array<number>(NULL_NF).fill(0);
  nullDecl[3] = -5.0; // catastrophic to win a trick
  nullDecl[4] = 0.6; // otherwise play the highest card that still ducks
  nullDecl[5] = 0.8; // when void, discard high
  nullDecl[6] = -0.4; // ...from a short suit

  const nullDef = new Array<number>(NULL_NF).fill(0);
  nullDef[0] = -0.8; // lead low to trap the declarer
  nullDef[2] = -1.5; // never lead a suit the declarer is void in
  nullDef[3] = -1.0; // don't grab the trick ourselves
  nullDef[4] = -0.4; // keep high cards back

  return { suitDecl, suitDef, nullDecl, nullDef };
}
