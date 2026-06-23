// Tunable weights for the heuristic bot (see bot.ts). Everything the bot used to
// hard-code as a magic number lives here instead, as a flat record of numbers so
// it can be perturbed by the evolution harness (experiments/, gitignored) and the
// winning weights pasted back into DEFAULT_PARAMS.
//
// Bidding decisions are linear scores: each game type sums a few hand features
// times their weights and is bid when the score clears that game's threshold.
// Play decisions are simple thresholds the same scoring touches. None of this
// needs to be integral; the comparisons are all `>=`, so evolved floats work.

export interface BotParams {
  // --- Suit game: bid when (trump*trumps + sideAce*sideAces + jack*jacks +
  //     void*sideVoids + ten*sideTens) >= threshold. (Jacks are also trumps, so
  //     `jack` is an extra nudge on top of their trump count.)
  suitTrump: number;
  suitSideAce: number;
  suitJack: number;
  suitVoid: number; // a side suit we hold no plain card in (can ruff it)
  suitTen: number; // a ten in a side suit
  suitThreshold: number;

  // --- Suit HAND game: play the dealt 10 cards closed (decline the skat) when
  //     (handTop*topRun + handTrumps*trumps) >= handThreshold. `topRun` is the
  //     number of guaranteed top tricks in the SIDE suits: the unbroken run from
  //     the top, an ace (1) or an ace and ten together (2), but never a ten
  //     without its ace. Only strong, top-heavy hands should risk the closed game.
  suitHandTop: number;
  suitHandTrumps: number;
  suitHandThreshold: number;

  // --- Grand: bid when (jack*jacks + ace*aces + clubJack*hasClubJack) >= threshold.
  grandJack: number;
  grandAce: number;
  grandClubJack: number;
  grandThreshold: number;

  // --- Null: only with no ace; counts of low cards (7/8/9) gate the two rungs.
  nullHandMinLows: number; // >= this -> play null hand (closed, no skat)
  nullMinLows: number; // >= this -> play null taking the skat

  // --- Auction position: when both opponents have already passed (we're sure to
  // get the contract uncontested), lower the suit/grand bidding bar by this much,
  // so a marginal hand we'd otherwise pass becomes worth a cheap, free game.
  passedPriorBonus: number;

  // --- Speculative pickup: during the auction (only), lower the suit/grand bar by
  // this much for EVERY hand, modelling the expected lift from the two skat cards
  // we'll pick up. Lets a borderline hand bid on the chance the skat improves it;
  // not applied when declaring (by then the real cards are known, so we bid those
  // honestly). Stacks additively with passedPriorBonus.
  skatBidBonus: number;

  // --- Play: declarer, suit/grand.
  declarerPullTrumpsMinOut: number; // keep leading trumps while this many or more are still out; below it, switch to cashing
  declarerCashSafeOnly: number; // > 0.5: when cashing a side master, skip suits an opponent can ruff (don't feed an ace to a ruff)
  // When following a side suit it could ruff, the declarer "breaks in" (spends a
  // trump to take the trick) when it is last to play, OR when this linear score
  // clears zero. The features: points already in the trick, trumps left in hand,
  // total cards left in hand, and high side cards (A/10) held; plus a bias.
  declRuffValue: number;
  declRuffTrumps: number;
  declRuffHand: number;
  declRuffSideHigh: number;
  declRuffBias: number;

  // --- Play: defender, suit/grand.
  defenderLeadHonour: number; // > 0.5: when partner sits behind the declarer, lead a K/Q up to them instead of a dead low card
  defenderCashMaster: number; // > 0.5: on lead, cash any card that has become the master of its suit (and can't be ruffed), not just aces
  // Whether to spend a trump to beat the declarer, scored like the declarer's ruff
  // (trick value, own trumps, cards left, high side cards) plus a term for being
  // last to play, where a ruff is safe from an over-ruff; breaks in when >= 0.
  defBreakValue: number;
  defBreakTrumps: number;
  defBreakHand: number;
  defBreakSideHigh: number;
  defBreakLast: number;
  defBreakBias: number;

  // --- Play: null (declarer must duck every trick, so this is the one real lever).
  nullLeadHigh: number; // > 0.5: when on lead in a null game, shed the highest safe card instead of the lowest
}

// Tuned by self-play evolution (experiments/, gitignored): 99 bots, tables of 3,
// 48 deals each, Seeger-Fabian selection, using perfect memory of the public play
// record (bot-memory.ts). The "break in with a trump" decisions (declRuff*,
// defBreak*) are linear scores over the trick value, trumps held, cards left, and
// side winners rather than flat thresholds. passedPriorBonus relaxes the bid bar
// when both opponents have passed.
//
// Two newer levers were added and then honestly A/B'd against this exact genome
// over 40k held-out deals with seats rotated (experiments/ab-skat.ts):
//   - suit HAND game (suitHand*): declining the skat to play the 10 cards closed
//     when 1.25*topRun + 1.07*trumps >= 9.75 (e.g. seven trumps and two top side
//     cards, or six and three). A small but real win: +0.2 pts/deal, win rate held
//     at ~80%. Below ~9.5 it turns sharply negative (the bot plays loose hand games
//     badly), so the threshold sits deliberately high.
//   - skatBidBonus: relax the bid bar for the expected skat lift. Sound in theory,
//     but every positive value LOST points here (the bot's play can't convert the
//     extra marginal contracts), so it ships at 0 -- the lever exists for tuning,
//     but speculative bidding is off until declarer play improves.
// To make the bot bid more often at some cost in win rate, lower suitThreshold /
// grandThreshold.
export const DEFAULT_PARAMS: BotParams = {
  suitTrump: 1.127,
  suitSideAce: 0.758,
  suitJack: 0.078,
  suitVoid: 0.554,
  suitTen: -0.108,
  suitThreshold: 7.193,

  suitHandTop: 1.25,
  suitHandTrumps: 1.07,
  suitHandThreshold: 9.75,

  grandJack: 0.542,
  grandAce: 0.865,
  grandClubJack: 0.887,
  grandThreshold: 4.359,

  // Null bidding is kept tight (this bot plays null poorly, so loose nulls are a
  // money-loser against real defence): no ace and effectively nine+ low cards.
  nullHandMinLows: 8,
  nullMinLows: 9.185,

  passedPriorBonus: 0.102,
  skatBidBonus: 0, // speculative bidding A/B'd negative; lever kept, tuned off

  declarerPullTrumpsMinOut: 1,
  declarerCashSafeOnly: 0,
  declRuffValue: -0.222,
  declRuffTrumps: -0.283,
  declRuffHand: 0.439,
  declRuffSideHigh: 0.321,
  declRuffBias: 4.557,

  defenderLeadHonour: 1,
  defenderCashMaster: 0.358,
  defBreakValue: -0.025,
  defBreakTrumps: 0.776,
  defBreakHand: 0.259,
  defBreakSideHigh: -0.142,
  defBreakLast: 0.206,
  defBreakBias: 0.004,

  nullLeadHigh: 0,
};

// The order/identity of the tunable genes, for the evolution harness. Keeping it
// here (next to the interface) means a new gene is added in exactly one place.
export const PARAM_KEYS: (keyof BotParams)[] = [
  'suitTrump',
  'suitSideAce',
  'suitJack',
  'suitVoid',
  'suitTen',
  'suitThreshold',
  'suitHandTop',
  'suitHandTrumps',
  'suitHandThreshold',
  'grandJack',
  'grandAce',
  'grandClubJack',
  'grandThreshold',
  'nullHandMinLows',
  'nullMinLows',
  'passedPriorBonus',
  'skatBidBonus',
  'declarerPullTrumpsMinOut',
  'declarerCashSafeOnly',
  'declRuffValue',
  'declRuffTrumps',
  'declRuffHand',
  'declRuffSideHigh',
  'declRuffBias',
  'defenderLeadHonour',
  'defenderCashMaster',
  'defBreakValue',
  'defBreakTrumps',
  'defBreakHand',
  'defBreakSideHigh',
  'defBreakLast',
  'defBreakBias',
  'nullLeadHigh',
];
