// Core domain types for the Skat engine.
// Skat is a 3-player trick-taking game played with a 32-card deck.

export type Suit = 'C' | 'S' | 'H' | 'D'; // Clubs, Spades, Hearts, Diamonds
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

// The kind of game the declarer plays.
export type Contract =
  | { type: 'suit'; suit: Suit } // a trump-suit game
  | { type: 'grand' } // only the four Jacks are trumps
  | { type: 'null' }; // no trumps; declarer must lose every trick

// Seat positions at the table, in play order for the first trick.
// Forehand always leads the first trick.
export type Seat = 0 | 1 | 2;

export const SUITS: Suit[] = ['C', 'S', 'H', 'D'];
export const RANKS: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
