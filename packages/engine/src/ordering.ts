import type { Card, Contract, Rank, Suit } from './types.ts';
import { cardId } from './cards.ts';

// In a suit or grand game the four Jacks are always trumps and outrank
// everything. Their order among themselves is fixed: ♣ > ♠ > ♥ > ♦.
const JACK_ORDER: Record<Suit, number> = { C: 4, S: 3, H: 2, D: 1 };

// Non-Jack rank strength inside one suit, high to low: A 10 K Q 9 8 7.
// Ascending index => 7 weakest, A strongest.
const SUIT_RANK_ASC: Rank[] = ['7', '8', '9', 'Q', 'K', '10', 'A'];

// Null games have no trumps and a plain ranking: A K Q J 10 9 8 7.
const NULL_RANK_ASC: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function isTrump(card: Card, contract: Contract): boolean {
  switch (contract.type) {
    case 'null':
      return false;
    case 'grand':
      return card.rank === 'J';
    case 'suit':
      return card.rank === 'J' || card.suit === contract.suit;
  }
}

// The suit a card "leads" with. In suit/grand games a Jack leads as trump,
// not as its printed suit. We model the trump line as a pseudo-suit 'T'.
export type LeadSuit = Suit | 'T';

export function leadSuit(card: Card, contract: Contract): LeadSuit {
  return isTrump(card, contract) ? 'T' : card.suit;
}

// A single comparable strength number within a trick context.
// Trumps always beat non-trumps, so trumps live in a higher band.
function strength(card: Card, contract: Contract): number {
  if (isTrump(card, contract)) {
    if (card.rank === 'J') return 1000 + JACK_ORDER[card.suit];
    // Non-Jack trump (only possible in a suit game): below all Jacks.
    return 100 + SUIT_RANK_ASC.indexOf(card.rank);
  }
  const table = contract.type === 'null' ? NULL_RANK_ASC : SUIT_RANK_ASC;
  return table.indexOf(card.rank);
}

// Given the cards played to a trick in play order, return the index of the
// winning card. `plays[0]` is the lead.
export function trickWinner(plays: Card[], contract: Contract): number {
  if (plays.length === 0) throw new Error('empty trick');
  const led = leadSuit(plays[0], contract);
  let bestIdx = 0;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i], plays[bestIdx], led, contract)) bestIdx = i;
  }
  return bestIdx;
}

function beats(card: Card, current: Card, led: LeadSuit, contract: Contract): boolean {
  const cTrump = isTrump(card, contract);
  const curTrump = isTrump(current, contract);
  if (cTrump !== curTrump) return cTrump; // a trump beats any non-trump
  if (cTrump && curTrump) return strength(card, contract) > strength(current, contract);
  // Both non-trump: a card can only win if it follows the led suit.
  // The current winner is always either a trump (handled above) or the led suit.
  if (card.suit !== led) return false;
  return strength(card, contract) > strength(current, contract);
}

// All trumps for a contract, ordered highest first. Used for matador counting
// and for UI hand sorting.
export function trumpsHighToLow(contract: Contract): Card[] {
  if (contract.type === 'null') return [];
  const jacks: Card[] = (['C', 'S', 'H', 'D'] as Suit[]).map((suit) => ({ suit, rank: 'J' }));
  if (contract.type === 'grand') return jacks;
  const suit = contract.suit;
  const nonJack: Card[] = [...SUIT_RANK_ASC].reverse().map((rank) => ({ suit, rank }));
  return [...jacks, ...nonJack];
}

const SIDE_DESC: Rank[] = ['A', '10', 'K', 'Q', '9', '8', '7']; // no Jack — Jacks are trumps
const NULL_DESC: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
const SUIT_DISPLAY_ORDER: Suit[] = ['C', 'S', 'H', 'D'];

// The full deck laid out left-to-right the way a player would hold it: trumps
// (Jacks first, then the trump suit) descending, then the side suits grouped
// and descending. With no contract yet (bidding/declaring) we default to a
// grand-style layout so the four Jacks sit together on the left.
function displayList(contract: Contract): Card[] {
  if (contract.type === 'null') {
    const out: Card[] = [];
    for (const suit of SUIT_DISPLAY_ORDER) for (const rank of NULL_DESC) out.push({ suit, rank });
    return out;
  }
  const trumpSuit = contract.type === 'suit' ? contract.suit : null;
  const out: Card[] = [...trumpsHighToLow(contract)];
  for (const suit of SUIT_DISPLAY_ORDER) {
    if (suit === trumpSuit) continue; // its cards are already among the trumps
    for (const rank of SIDE_DESC) out.push({ suit, rank });
  }
  return out;
}

// Sorts a hand for display. Pass the active contract once known; otherwise a
// sensible default (grand-style, Jacks high) is used.
export function sortHand(hand: Card[], contract?: Contract): Card[] {
  const order = displayList(contract ?? { type: 'grand' });
  const index = new Map(order.map((c, i) => [cardId(c), i]));
  return [...hand].sort((a, b) => (index.get(cardId(a)) ?? 0) - (index.get(cardId(b)) ?? 0));
}
