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

  // --- Grand: bid when (jack*jacks + ace*aces + clubJack*hasClubJack) >= threshold.
  grandJack: number;
  grandAce: number;
  grandClubJack: number;
  grandThreshold: number;

  // --- Null: only with no ace; counts of low cards (7/8/9) gate the two rungs.
  nullHandMinLows: number; // >= this -> play null hand (closed, no skat)
  nullMinLows: number; // >= this -> play null taking the skat

  // --- Play: declarer, suit/grand.
  declarerPullTrumpsMinOut: number; // keep leading trumps while this many or more are still out; below it, switch to cashing
  trumpInMinValue: number; // spend a trump on a side-suit trick only if it's worth >= this
  declarerCashSafeOnly: number; // > 0.5: when cashing a side master, skip suits an opponent can ruff (don't feed an ace to a ruff)

  // --- Play: defender, suit/grand.
  defenderBreakInTrumps: number; // trump in over the declarer if holding >= this many trumps
  defenderBreakInValue: number; // ...or if the trick is already worth >= this
  defenderLeadHonour: number; // > 0.5: when partner sits behind the declarer, lead a K/Q up to them instead of a dead low card
  defenderCashMaster: number; // > 0.5: on lead, cash any card that has become the master of its suit (and can't be ruffed), not just aces

  // --- Play: null (declarer must duck every trick, so this is the one real lever).
  nullLeadHigh: number; // > 0.5: when on lead in a null game, shed the highest safe card instead of the lowest
}

// Tuned by self-play evolution (experiments/, gitignored): 99 bots, tables of 3,
// 48 deals each, Seeger-Fabian selection, ~80 generations, using perfect memory of
// the public play record (bot-memory.ts). Head-to-head against the previous
// hand-tuned bot (git HEAD), this genome wins by ~+9 points/deal with a ~77%
// declarer win rate vs ~61%, on deals the search never saw. It bids selectively
// (passing marginal games that lose 2x when they fail), defends very aggressively
// (trumps in readily), and cashes guaranteed winners without feeding them to ruffs.
// To make the bot bid more often at some cost in win rate, lower suitThreshold /
// grandThreshold.
export const DEFAULT_PARAMS: BotParams = {
  suitTrump: 1.128,
  suitSideAce: 0.711,
  suitJack: 0.026,
  suitVoid: 0.093,
  suitTen: -0.017,
  suitThreshold: 6.782,

  grandJack: 0,
  grandAce: 1.096,
  grandClubJack: 0.965,
  grandThreshold: 3.403,

  nullHandMinLows: 7.624,
  nullMinLows: 7.691,

  declarerPullTrumpsMinOut: 1,
  trumpInMinValue: 0,
  declarerCashSafeOnly: 0.96,
  defenderBreakInTrumps: 0.24,
  defenderBreakInValue: 11.608,
  defenderLeadHonour: 0.205,
  defenderCashMaster: 0.636,
  nullLeadHigh: 0.929,
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
  'grandJack',
  'grandAce',
  'grandClubJack',
  'grandThreshold',
  'nullHandMinLows',
  'nullMinLows',
  'declarerPullTrumpsMinOut',
  'trumpInMinValue',
  'declarerCashSafeOnly',
  'defenderBreakInTrumps',
  'defenderBreakInValue',
  'defenderLeadHonour',
  'defenderCashMaster',
  'nullLeadHigh',
];
