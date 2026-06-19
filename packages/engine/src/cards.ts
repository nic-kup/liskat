import type { Card, Rank, Suit } from './types.ts';
import { SUITS, RANKS } from './types.ts';

// Card point values. The 32 cards total 120 points.
const POINTS: Record<Rank, number> = {
  A: 11,
  '10': 10,
  K: 4,
  Q: 3,
  J: 2,
  '9': 0,
  '8': 0,
  '7': 0,
};

export function cardPoints(card: Card): number {
  return POINTS[card.rank];
}

export function totalPoints(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

// Stable string id, useful as a map key and over the wire, e.g. "CJ", "H10".
export function cardId(card: Card): string {
  return card.suit + card.rank;
}

export function cardFromId(id: string): Card {
  const suit = id[0] as Suit;
  const rank = id.slice(1) as Rank;
  return { suit, rank };
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

// A fresh, ordered 32-card Skat deck.
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}
