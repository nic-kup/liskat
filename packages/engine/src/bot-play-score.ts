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
import { cardId, cardPoints, totalPoints } from './cards.ts';
import { isTrump, leadSuit, trickWinner } from './ordering.ts';
import { buildMemory, isCategoryMaster, outstandingTrumps, type PlayMemory } from './bot-memory.ts';
import type { RoundState } from './round.ts';

// ---- the learnable weights -------------------------------------------------

// Weight vectors, one per play role. suit*/grand* are length SUIT_FEATURES.length,
// null* are length NULL_FEATURES.length. Carried inside BotParams as playW.
//
// grandDecl/grandDef are OPTIONAL. Grand and suit share an identical feature/trump
// structure, so historically both routed through suitDecl/suitDef. They are not the
// same GAME though (grand: only jacks are trump, side suits are long; the right
// trump-pull / cashing tradeoffs differ), so grand can carry its own vectors. When
// a grand vector is absent the code falls back to the suit one -- i.e. omitting them
// reproduces the old shared-weights behaviour exactly.
export interface PlayWeights {
  suitDecl: number[];
  suitDef: number[];
  grandDecl?: number[];
  grandDef?: number[];
  nullDecl: number[];
  nullDef: number[];
  // Optional PER-SEAT suit-defender vectors. The two defenders sit in structurally
  // different spots: "before" = just before the declarer (declarer+2, wants the lead
  // to sandwich the declarer in middle-hand), "after" = just after (declarer+1, plays
  // second-hand behind the declarer). A single suitDef forces both to play identically;
  // these let each seat specialise. Selected by seat in chooseCardScored; ABSENT -> both
  // fall back to suitDef (so omitting them reproduces the shared-vector behaviour exactly).
  suitDefBefore?: number[]; // suit defender sitting just before the declarer (declarer+2)
  suitDefAfter?: number[]; // suit defender sitting just after the declarer (declarer+1)
  grandDefBefore?: number[]; // grand defender just before the declarer (else grandDef -> suitDef)
  grandDefAfter?: number[]; // grand defender just after the declarer (else grandDef -> suitDef)
  // Learnable skat discard (optional). The two buried cards become the skat, which
  // COUNTS for the declarer, so the discard trades banked points, trump economy, and
  // creating a ruffing void. Scored over candidate PAIRS (see chooseDiscardScored).
  // Absent -> the bot falls back to the hand-written discard heuristic (bot.ts).
  discSuit?: number[]; // suit discard (DISC_SUIT_FEATURES)
  // Grand discard. Same DISC_SUIT_FEATURES, but computed under grand trump rules (only the
  // four jacks are trump, side suits are longer), so the void / trump / ten-bare tradeoffs
  // differ enough to warrant their own vector -- the same reasoning that split grandDecl from
  // suitDecl. ABSENT -> grand falls back to discSuit (so omitting it is byte-identical).
  discGrand?: number[];
  discNull?: number[]; // null discard (DISC_NULL_FEATURES)
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
  // --- iteration 5: the schneider/schwarz LINES (previously only the 61/60 game goal
  //     was modelled) plus tempo and ten-protection. ---
  'def_secure30', // following+win (defender): this trick lifts the defence to 30 -> denies the declarer the schneider multiplier (cuts game value even on a lost defence)
  'decl_press90', // following+win (declarer): already past 61, this trick crosses 90 -> schneiders the defenders (raises game value)
  'win_late', // following+win: scaled by how late in the hand it is (cash winners when fewer tricks remain)
  'ten_protect', // following+lose: surrendering a TEN (10 pts, beaten only by the ace) to an opponent -- sharper than generic lose_pts
  // --- iteration 6: graded ruff-risk. The binary lead_ruffrisk can't tell a GOOD force-ruff
  //     (declarer ruffs a low card, wasting a trump) from a BAD one (our side's A/10 get
  //     donated to the ruff). Grade it by the high points (A/10) still outstanding in the
  //     suit, so the model keeps forcing low-card ruffs but avoids donating high cards.
  'lead_ruff_highpts', // leading: a side suit a waiting opponent can ruff, scaled by the A/10 still out in it (we'd feed them to the ruff)
  // --- iteration 7 (defender card-awareness): don't take a trick our PARTNER already
  //     holds. When I am LAST to play and my ally is winning, there is no opponent left
  //     to beat them, so overtaking only wastes a high card (schmier instead). Naturally
  //     defender-only: a declarer has no ally, so friendWinning is never set for them.
  'overtake_partner', // following+win+last: this card takes the trick FROM my winning partner (pure waste)
  // --- iteration 16 (defender card-awareness): don't "cash" a DEAD master. lead_master
  //     (+3.73) rewards leading a master, but a master in a side suit a waiting opponent can
  //     ruff is dead -- it gets ruffed whenever led, so leading it just donates the card to the
  //     declarer's ruff instead of keeping it to schmier onto my partner. This is the direct
  //     complement of lead_master_safe (master AND NOT ruffable): master AND ruffable. A
  //     negative weight cancels the spurious master-cash bonus so the bot leads a low/other
  //     card and holds the honour. (A declarer never has a waiting OPPONENT to ruff a side
  //     lead, so this is effectively defender-only.)
  'lead_dead_master', // leading: a master in a side suit a waiting opp can ruff (dead -> don't donate it)
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

// Discard is scored over candidate PAIRS of cards to bury (see chooseDiscardScored).
export const DISC_SUIT_FEATURES = [
  'd_pts', // total card points buried (skat counts for the declarer -> banks them safely)
  'd_trump', // trumps in the pair (almost never bury a trump)
  'd_ace', // aces in the pair (keep aces -> winners/guards)
  'd_ten_bare', // tens whose ace we do NOT hold (bury to bank the 10 safely)
  'd_void', // side-suit voids the pair CREATES (enables ruffing) 0..2
  'd_str', // total trick-strength buried (keep strong cards -> bury weak ones)
] as const;
export const DISC_NULL_FEATURES = [
  'dn_rank', // total null-rank buried (bury the dangerous high cards)
  'dn_ace', // aces buried (aces are death in null)
  'dn_void', // side-suit voids created (a void can never be forced to win)
  'dn_low', // low cards (7/8/9) buried (keep these -> safe ducks)
] as const;

export const SUIT_NF = SUIT_FEATURES.length;
export const NULL_NF = NULL_FEATURES.length;
export const DISC_SUIT_NF = DISC_SUIT_FEATURES.length;
export const DISC_NULL_NF = DISC_NULL_FEATURES.length;

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
  // Defender seat position relative to the declarer (false for the declarer itself).
  // "Good" = I sit just BEFORE the declarer (seat declarer+2): when I lead, the
  // declarer is forced into middle-hand and my partner gets last say. "Bad" = I sit
  // just AFTER the declarer (seat declarer+1): when I lead, the declarer plays in
  // rear-hand (sees everything). Used to pick the per-seat suit-defender weight
  // vector (suitDefBefore/suitDefAfter) in chooseCardScored.
  defPosGood: boolean; // I am the defender just before the declarer (declarer+2)
  defPosBad: boolean; // I am the defender just after the declarer (declarer+1)
  myBanked: number; // points my side has already secured this deal
  myGoal: number; // points my side needs to win the card play (declarer 61, defenders 60)
  trickCount: number; // tricks already collected this deal (0..9), for endgame/tempo scaling
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

  // Where I sit relative to the declarer (defenders only).
  let defPosGood = false;
  let defPosBad = false;
  if (!iAmDeclarer && s.declarer !== null) {
    defPosGood = seat === (((s.declarer + 2) % 3) as Seat); // just before the declarer
    defPosBad = seat === (((s.declarer + 1) % 3) as Seat); // just after the declarer
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
    defPosGood, defPosBad,
    myBanked, myGoal, trickCount: s.trickCount,
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

// High points (A/10) of side suit `suit` that are still OUT THERE: not yet played and
// not in our own hand, so an opponent's ruff of this suit would capture them.
function outstandingHighPts(suit: string, ctx: Ctx): number {
  let pts = 0;
  for (const [rank, p] of [['A', 11], ['10', 10]] as const) {
    const inHand = ctx.hand.some((h) => h.suit === suit && h.rank === rank);
    if (!inHand && !ctx.mem.playedIds.has(cardId({ suit: suit as Card['suit'], rank }))) pts += p;
  }
  return pts;
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
    // graded ruff-risk: leading a side suit a waiting opponent can ruff, scaled by the
    // A/10 still out in it (those high cards would be fed to the ruff).
    f[31] = !trump && waitingCanRuff(c.suit, ctx) ? outstandingHighPts(c.suit, ctx) / 21 : 0;
    // don't cash a DEAD master: a master in a side suit a waiting opponent can ruff just gets
    // ruffed -> lead a low/other card and keep the honour to schmier. Complement of f[5].
    f[33] = !trump && master && waitingCanRuff(c.suit, ctx) ? 1 : 0;
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
    // iteration-5 features (all per-candidate; gated so the irrelevant role contributes 0).
    const isTen = c.rank === '10' ? 1 : 0;
    f[27] = !ctx.iAmDeclarer && ctx.myBanked < 30 && ctx.myBanked + captPoints >= 30 ? win : 0; // defender: secure 30 (anti-schneider)
    f[28] = ctx.iAmDeclarer && ctx.myBanked < 90 && ctx.myBanked + captPoints >= 90 ? win : 0; // declarer: cross 90 (schneider press)
    f[29] = win * (ctx.trickCount / 10); // endgame urgency: a win is worth more late
    f[30] = lose * isTen * (ctx.oppWinning ? 1 : 0); // protect tens: don't surrender a 10 to an opponent
    // RUFFING my winning partner as last hand: I spend a trump to take a side-suit trick
    // the partner already holds -- pure waste of a trump (in-suit overtakes that bank points
    // are left alone; self-play rewards banking, since a kept high card often gets ruffed).
    f[32] = win * (ctx.friendWinning ? 1 : 0) * (isLast ? 1 : 0) * trump * ruffSide;
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

// Pick the role's weight vector + the matching feature builder/names for this decision.
// Shared by scoreCardsScored (the bot's play) and explainCardsScored (the tutorial hints)
// so an explanation always decomposes the SAME score the bot actually plays on.
function playModel(ctx: Ctx, w: PlayWeights): { weights: number[]; feats: (c: Card, ctx: Ctx) => number[]; names: readonly string[] } {
  const isNull = ctx.contract.type === 'null';
  const isGrand = ctx.contract.type === 'grand';
  let weights: number[];
  if (isNull) weights = ctx.iAmDeclarer ? w.nullDecl : w.nullDef;
  else if (ctx.iAmDeclarer) weights = isGrand ? (w.grandDecl ?? w.suitDecl) : w.suitDecl;
  else {
    // Suit/grand DEFENDER: pick the per-seat vector for my position relative to the
    // declarer (before/after), falling back through the shared grand/suit vectors when a
    // split vector isn't set -- so omitting them reproduces the shared-vector behaviour.
    const before = isGrand ? (w.grandDefBefore ?? w.grandDef ?? w.suitDef) : (w.suitDefBefore ?? w.suitDef);
    const after = isGrand ? (w.grandDefAfter ?? w.grandDef ?? w.suitDef) : (w.suitDefAfter ?? w.suitDef);
    weights = ctx.defPosGood ? before : after; // defPosBad (or, defensively, neither) -> after
  }
  return isNull ? { weights, feats: nullFeatures, names: NULL_FEATURES } : { weights, feats: suitFeatures, names: SUIT_FEATURES };
}

// Linear score of every legal card with the role's weight vector, in `legal` order.
// Factored out so both the argmax chooser and the softmax sampler score identically.
export function scoreCardsScored(s: RoundState, seat: Seat, legal: Card[], w: PlayWeights): number[] {
  const ctx = buildCtx(s, seat);
  const { weights, feats } = playModel(ctx, w);
  return legal.map((c) => dot(feats(c, ctx), weights));
}

// One feature's signed push on a card's score: contribution = value * weight. The features
// are named (SUIT_FEATURES / NULL_FEATURES) and documented, so a large positive contribution
// is a human-readable reason the card scores well.
export interface CardContribution {
  feature: string;
  value: number; // the per-card feature value in this situation
  weight: number; // the learned weight on that feature for this role
  contribution: number; // value * weight (the term's signed effect on the score)
}
export interface CardExplanation {
  score: number; // total linear score (matches scoreCardsScored)
  contributions: CardContribution[]; // every feature term, sorted by |contribution| descending
}

// Decompose each legal card's score into its per-feature contributions, so a UI can show
// WHY the model likes (or dislikes) a card -- e.g. the tutorial "best play" thought-bubble.
// Pure and side-effect free; uses the exact same weights/features the bot plays with.
export function explainCardsScored(s: RoundState, seat: Seat, legal: Card[], w: PlayWeights): CardExplanation[] {
  const ctx = buildCtx(s, seat);
  const { weights, feats, names } = playModel(ctx, w);
  return legal.map((c) => {
    const f = feats(c, ctx);
    const contributions: CardContribution[] = f.map((value, i) => ({ feature: names[i], value, weight: weights[i] ?? 0, contribution: value * (weights[i] ?? 0) }));
    const score = contributions.reduce((a, b) => a + b.contribution, 0);
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return { score, contributions };
  });
}

// Choose a card from `legal` by linear scoring with the role's weight vector.
// Ties (equal score) resolve to the FIRST legal card, which `legalCards` returns
// in a stable hand order, so play is deterministic.
export function chooseCardScored(s: RoundState, seat: Seat, legal: Card[], w: PlayWeights): Card {
  const scores = scoreCardsScored(s, seat, legal, w);
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  return legal[best];
}

// The sampling distribution over the candidate cards: a BANDED softmax. Cards whose score
// is more than `bandDelta` below the best are excluded (probability 0) so a clearly-worse
// card is never played; the softmax(score/temp) runs over the remaining top band. With
// temp <= 0, fewer than two eligible cards, or a single legal card, it degenerates to a
// one-hot on the argmax (greedy). Numerically stable (subtracts the max before exp). This
// is the single source of truth for both sampling and the measured play entropy.
export function bandedSoftmaxProbs(scores: number[], temp: number, bandDelta = 0): number[] {
  const n = scores.length;
  const probs = new Array<number>(n).fill(0);
  let best = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
  if (!(temp > 0) || n <= 1) { probs[best] = 1; return probs; }
  const max = scores[best];
  const cutoff = bandDelta > 0 ? max - bandDelta : -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) if (scores[i] >= cutoff) { probs[i] = Math.exp((scores[i] - max) / temp); sum += probs[i]; }
  if (sum <= 0) { probs.fill(0); probs[best] = 1; return probs; }
  for (let i = 0; i < n; i++) probs[i] /= sum;
  return probs;
}

// Pick an index from a probability vector using a [0,1) draw. Caller seeds `rand` from
// game state for reproducibility.
export function sampleFromProbs(probs: number[], rand: number): number {
  let r = rand;
  for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return i; }
  for (let i = probs.length - 1; i >= 0; i--) if (probs[i] > 0) return i; // float guard
  return 0;
}

// Sample a card from the banded softmax over the legal candidates (one call).
export function sampleCardSoftmax(scores: number[], legal: Card[], temp: number, rand: number, bandDelta = 0): Card {
  return legal[sampleFromProbs(bandedSoftmaxProbs(scores, temp, bandDelta), rand)];
}

// Convenience: score + banded-softmax-sample in one call.
export function chooseCardSoftmax(s: RoundState, seat: Seat, legal: Card[], w: PlayWeights, temp: number, rand: number, bandDelta = 0): Card {
  return sampleCardSoftmax(scoreCardsScored(s, seat, legal, w), legal, temp, rand, bandDelta);
}

// ---- learnable skat discard ------------------------------------------------

// Features of burying the pair (a, b) from the 12-card hand in a suit/grand game.
function discSuitFeatures(a: Card, b: Card, hand: Card[], contract: Contract): number[] {
  const pair = [a, b];
  const pts = (cardPoints(a) + cardPoints(b)) / 22;
  const trump = (isTrump(a, contract) ? 1 : 0) + (isTrump(b, contract) ? 1 : 0);
  const ace = (a.rank === 'A' ? 1 : 0) + (b.rank === 'A' ? 1 : 0);
  const hasAceOf = (suit: string) => hand.some((c) => c.rank === 'A' && c.suit === suit);
  const tenBare = pair.reduce((n, c) => n + (c.rank === '10' && !isTrump(c, contract) && !hasAceOf(c.suit) ? 1 : 0), 0);
  // Voids created: a non-trump category all of whose cards are in the pair.
  let voids = 0;
  for (const cat of new Set(pair.map((c) => leadSuit(c, contract)))) {
    if (cat === 'T') continue;
    const inHand = hand.filter((c) => leadSuit(c, contract) === cat).length;
    const inPair = pair.filter((c) => leadSuit(c, contract) === cat).length;
    if (inHand > 0 && inPair === inHand) voids++;
  }
  const str = str01(a, contract) + str01(b, contract);
  return [pts, trump, ace, tenBare, voids, str];
}

// Features of burying the pair (a, b) in a null game (no trumps; bury danger).
function discNullFeatures(a: Card, b: Card, hand: Card[]): number[] {
  const pair = [a, b];
  const rank = nullRank01(a) + nullRank01(b);
  const ace = (a.rank === 'A' ? 1 : 0) + (b.rank === 'A' ? 1 : 0);
  let voids = 0;
  for (const cat of new Set(pair.map((c) => c.suit))) {
    const inHand = hand.filter((c) => c.suit === cat).length;
    const inPair = pair.filter((c) => c.suit === cat).length;
    if (inHand > 0 && inPair === inHand) voids++;
  }
  const low = pair.reduce((n, c) => n + (c.rank === '7' || c.rank === '8' || c.rank === '9' ? 1 : 0), 0);
  return [rank, ace, voids, low];
}

// Bury the highest-scoring pair from the 12-card hand. Returns null when no discard
// weights are set, so the caller falls back to the hand-written heuristic.
export function chooseDiscardScored(hand12: Card[], contract: Contract, w: PlayWeights): [Card, Card] | null {
  const isNull = contract.type === 'null';
  const isGrand = contract.type === 'grand';
  // Grand uses its own vector when set, else falls back to discSuit (byte-identical default).
  const weights = isNull ? w.discNull : isGrand ? (w.discGrand ?? w.discSuit) : w.discSuit;
  if (!weights || weights.length === 0) return null;
  let best: [Card, Card] = [hand12[0], hand12[1]];
  let bestScore = -Infinity;
  for (let i = 0; i < hand12.length; i++) {
    for (let j = i + 1; j < hand12.length; j++) {
      const f = isNull ? discNullFeatures(hand12[i], hand12[j], hand12) : discSuitFeatures(hand12[i], hand12[j], hand12, contract);
      const sc = dot(f, weights);
      if (sc > bestScore) { bestScore = sc; best = [hand12[i], hand12[j]]; }
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
  suitDecl[28] = 0.4; // press to 90 (schneider) once safe
  suitDecl[29] = 0.3; // cash winners late
  suitDecl[30] = -0.5; // don't hand a ten to an opponent

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
  suitDef[27] = 1.2; // secure 30 to deny the declarer schneider
  suitDef[29] = 0.2; // cash winners late
  suitDef[30] = -0.5; // don't hand a ten to the declarer

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

  // Discard priors that roughly reproduce the heuristic: bury low non-trump cards,
  // bank points, create a void, never bury trumps or aces; null buries the danger.
  const discSuit = new Array<number>(DISC_SUIT_NF).fill(0);
  discSuit[0] = 0.5; // bank points into the skat
  discSuit[1] = -5.0; // never bury a trump
  discSuit[2] = -3.0; // keep aces
  discSuit[3] = 1.5; // bury a bare ten (bank the 10 safely)
  discSuit[4] = 2.0; // create a ruffing void
  discSuit[5] = -1.2; // keep strong cards, bury weak

  const discNull = new Array<number>(DISC_NULL_NF).fill(0);
  discNull[0] = 1.0; // bury high cards
  discNull[1] = 3.0; // bury aces
  discNull[2] = 1.5; // create a void
  discNull[3] = -1.5; // keep low cards

  return { suitDecl, suitDef, nullDecl, nullDef, discSuit, discNull };
}
