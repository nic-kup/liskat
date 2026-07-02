import type { Card, Contract } from './types.ts';
import { cardsEqual } from './cards.ts';
import { trumpsHighToLow } from './ordering.ts';

// Base game values.
export const SUIT_BASE: Record<string, number> = { D: 9, H: 10, S: 11, C: 12 };
export const GRAND_BASE = 24;

// Null is scored at fixed values, never multiplied.
export const NULL_VALUES = {
  plain: 23,
  hand: 35,
  ouvert: 46,
  handOuvert: 59,
};

export function baseValue(contract: Contract): number {
  if (contract.type === 'null') return NULL_VALUES.plain; // overridden in computeGameValue
  if (contract.type === 'grand') return GRAND_BASE;
  return SUIT_BASE[contract.suit];
}

// Extras that raise a suit/grand multiplier (or pick the null ladder rung).
export interface PreviewOpts {
  hand?: boolean;
  schneider?: boolean;
  schneiderAnnounced?: boolean;
  schwarz?: boolean;
  schwarzAnnounced?: boolean;
  ouvert?: boolean;
}

// The game value to *display* for a contract before or during declaring: the
// base value times the multiplier (matadors + the game itself + one per active
// extra), or the fixed null ladder. This is the single source of truth the
// declare panel and the how-to-play calculator both render, so neither has to
// re-hardcode the base values or null rungs that computeGameValue scores with.
// `matadors` is the with/without count (ignored for null).
export function previewGameValue(contract: Contract, matadors: number, opts: PreviewOpts = {}): number {
  if (contract.type === 'null') {
    if (opts.hand && opts.ouvert) return NULL_VALUES.handOuvert;
    if (opts.ouvert) return NULL_VALUES.ouvert;
    if (opts.hand) return NULL_VALUES.hand;
    return NULL_VALUES.plain;
  }
  let mult = matadors + 1;
  if (opts.hand) mult += 1;
  if (opts.schneider) mult += 1;
  if (opts.schneiderAnnounced) mult += 1;
  if (opts.schwarz) mult += 1;
  if (opts.schwarzAnnounced) mult += 1;
  if (opts.ouvert) mult += 1;
  return baseValue(contract) * mult;
}

// "Matadors" (Spitzen): the run of consecutive top trumps the declarer holds,
// counting down from ♣J. If the declarer holds ♣J they play "with" N; if not,
// they play "without" N (the count of top trumps they are missing in a row).
// The number N is the same magnitude in either case.
export function countMatadors(declarerCards: Card[], contract: Contract): number {
  const order = trumpsHighToLow(contract);
  if (order.length === 0) return 0; // null
  const has = (c: Card) => declarerCards.some((d) => cardsEqual(d, c));
  const topHeld = has(order[0]);
  let n = 0;
  for (const trump of order) {
    if (has(trump) === topHeld) n++;
    else break;
  }
  return n;
}

export interface GameOutcome {
  // Card points the declarer collected (tricks won + the two skat cards).
  declarerCardPoints: number;
  // Number of tricks the defenders won (for schwarz detection).
  defenderTricks: number;
  // For null: did the declarer win at least one trick? (loses the game if so)
  declarerWonATrick?: boolean;
}

export interface Announcements {
  hand: boolean; // declarer did not pick up the skat
  schneiderAnnounced: boolean;
  schwarzAnnounced: boolean;
  ouvert: boolean; // open hand
}

export interface GameValueResult {
  won: boolean;
  value: number; // the positive game value
  multiplier: number; // suit/grand only, for display
  schneider: boolean; // declarer made 90+ (or held opponents to <31)
  schwarz: boolean; // opponents took no trick
  cardPoints?: number; // declarer's eyes (suit/grand only; meaningless for null)
}

// Computes whether the declarer won and the game value, given the contract,
// the declarer's full set of trump-relevant cards (the 10 played + 2 skat),
// the result of play, the bid, and any announcements.
export function computeGameValue(
  contract: Contract,
  declarerCards: Card[],
  outcome: GameOutcome,
  announcements: Announcements,
  bid: number,
): GameValueResult {
  if (contract.type === 'null') {
    return computeNull(announcements, outcome, bid);
  }

  const points = outcome.declarerCardPoints;
  // Schneider/schwarz raise the game value for WHICHEVER side achieves them (ISkO):
  // the declarer makes schneider at 90+, but is *made* schneider when held to <=30
  // (the defenders reached 90) -- both add the multiplier. Likewise schwarz applies
  // when either side takes no trick (defenders none = declarer schwarz; declarer none
  // = declarer made schwarz). This matters on lost games: a schneidered/schwarzed
  // declarer is charged the higher value.
  const schneider = points >= 90 || points <= 30;
  const schwarz = outcome.defenderTricks === 0 || outcome.declarerWonATrick === false;
  const madePrimary = points >= 61; // need more than half of 120

  const base = baseValue(contract);
  const matadors = countMatadors(declarerCards, contract);
  let multiplier = matadors + 1; // +1 for the game itself
  if (announcements.hand) multiplier += 1;
  if (schneider) multiplier += 1;
  if (announcements.schneiderAnnounced) multiplier += 1;
  if (schwarz) multiplier += 1;
  if (announcements.schwarzAnnounced) multiplier += 1;
  if (announcements.ouvert) multiplier += 1;

  let value = base * multiplier;

  // Loss conditions: failed to reach 61, OR announced schneider/schwarz but
  // didn't deliver, OR overbid (the realized value is below the bid).
  let won = madePrimary;
  if (announcements.schneiderAnnounced && !schneider) won = false;
  if (announcements.schwarzAnnounced && !schwarz) won = false;
  if (value < bid) {
    // Overbid: the game is lost and charged at the lowest game level (a multiple
    // of the base value) that reaches the bid, not at the value actually played.
    won = false;
    multiplier = Math.ceil(bid / base);
    value = base * multiplier;
  }

  return { won, value, multiplier, schneider, schwarz, cardPoints: points };
}

function computeNull(
  announcements: Announcements,
  outcome: GameOutcome,
  bid: number,
): GameValueResult {
  let value: number;
  if (announcements.hand && announcements.ouvert) value = NULL_VALUES.handOuvert;
  else if (announcements.ouvert) value = NULL_VALUES.ouvert;
  else if (announcements.hand) value = NULL_VALUES.hand;
  else value = NULL_VALUES.plain;

  // Declarer wins null only by losing every trick, and must not be overbid.
  const won = outcome.declarerWonATrick === false && value >= bid;
  return { won, value, multiplier: 1, schneider: false, schwarz: false };
}

// Translates a game result into a points delta for a running session score.
// Default rule (common club scoring): win => +value, loss => -2*value.
export function sessionDelta(result: GameValueResult): number {
  return result.won ? result.value : -2 * result.value;
}
