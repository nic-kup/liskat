// Perfect memory of the PUBLIC card record, for the bot to reason with. Nothing
// here peeks at hidden hands or the skat: it only digests what every player at
// the table has already seen go to the tricks (RoundState.completedTricks plus
// the trick in progress). This is exactly the bookkeeping a strong human does.
//
// From the play record we infer:
//   * which exact cards are gone,
//   * which players have shown void in a category (suit or trump) by failing to
//     follow it, so we know they cannot win / can ruff there,
//   * whether a given card is now the master (highest live) of its category,
//   * how many trumps the opponents can still be holding.

import type { Card, Contract, Seat, Suit } from './types.ts';
import { cardId } from './cards.ts';
import { isTrump, leadSuit, trumpsHighToLow, type LeadSuit } from './ordering.ts';

// Non-jack side-suit ranks, weakest to strongest (jacks are trumps, not here).
const SIDE_RANKS_DESC: Card['rank'][] = ['A', '10', 'K', 'Q', '9', '8', '7'];

export interface PlayMemory {
  // Every card seen played so far (collected tricks + the current trick).
  playedIds: Set<string>;
  // Per-seat categories the seat has shown void in (couldn't follow that lead).
  voids: [Set<LeadSuit>, Set<LeadSuit>, Set<LeadSuit>];
}

// Digest the public play record into a PlayMemory.
export function buildMemory(s: { completedTricks: { seat: Seat; card: Card }[][]; trick: { seat: Seat; card: Card }[] }, contract: Contract): PlayMemory {
  const playedIds = new Set<string>();
  const voids: PlayMemory['voids'] = [new Set(), new Set(), new Set()];
  const tricks = s.trick.length > 0 ? [...s.completedTricks, s.trick] : s.completedTricks;
  for (const trick of tricks) {
    if (trick.length === 0) continue;
    const led = leadSuit(trick[0].card, contract);
    for (let i = 0; i < trick.length; i++) {
      const { seat, card } = trick[i];
      playedIds.add(cardId(card));
      // A legal play that doesn't follow the lead means the player held nothing
      // of that category: they are void in it.
      if (i > 0 && leadSuit(card, contract) !== led) voids[seat].add(led);
    }
  }
  return { playedIds, voids };
}

const isGone = (mem: PlayMemory, c: Card) => mem.playedIds.has(cardId(c));
const inHand = (hand: Card[], c: Card) => hand.some((h) => h.suit === c.suit && h.rank === c.rank);

// Is `card` the highest live card of its own category? I.e. every card that
// would beat it within that category is either already played or in our own hand
// (so no opponent can hold it). For a side suit this ignores trumps: a side
// master still loses to a ruff, so callers pair it with `safeToCash`.
// `known` are extra cards the caller can account for beyond `hand` and the played
// pile: for the declarer in a skat game, its own buried discard. A higher card sitting
// in that discard can never appear, so it doesn't stop our card from being the master.
export function isCategoryMaster(card: Card, hand: Card[], mem: PlayMemory, contract: Contract, known: Card[] = []): boolean {
  const accounted = (c: Card) => inHand(hand, c) || known.some((k) => k.suit === c.suit && k.rank === c.rank);
  if (isTrump(card, contract)) {
    for (const t of trumpsHighToLow(contract)) {
      if (cardId(t) === cardId(card)) break; // reached our card: nothing higher remains unaccounted for
      if (!isGone(mem, t) && !accounted(t)) return false;
    }
    return true;
  }
  // Side suit: check higher ranks of the same suit.
  for (const rank of SIDE_RANKS_DESC) {
    if (rank === card.rank) break;
    const higher: Card = { suit: card.suit, rank };
    if (!isGone(mem, higher) && !accounted(higher)) return false;
  }
  return true;
}

// Trumps that could still be in OTHER players' hands: all trumps minus our own,
// minus those already played, minus any we can account for (the skat, when we
// are the declarer and so know our discard).
export function outstandingTrumps(hand: Card[], mem: PlayMemory, contract: Contract, knownExtra: Card[] = []): Card[] {
  const accounted = new Set<string>([...hand, ...knownExtra].map(cardId));
  return trumpsHighToLow(contract).filter((t) => !accounted.has(cardId(t)) && !isGone(mem, t));
}

// Can any of `opponents` ruff the given side suit? True if one of them is void in
// that suit AND is not known to be out of trumps. If no trumps remain out there
// at all, nobody can ruff.
export function someoneCanRuff(suit: Suit, opponents: Seat[], mem: PlayMemory, trumpsOut: number): boolean {
  if (trumpsOut <= 0) return false;
  return opponents.some((o) => mem.voids[o].has(suit) && !mem.voids[o].has('T'));
}
