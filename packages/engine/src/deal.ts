import type { Card } from './types.ts';
import { freshDeck } from './cards.ts';

// A dealt Skat round: 10 cards to each of the three players, 2 to the skat.
export interface Deal {
  hands: [Card[], Card[], Card[]];
  skat: [Card, Card];
}

// Deterministic shuffle driven by an injected RNG so games are reproducible
// and the server stays authoritative over randomness. `rng` returns [0,1).
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Traditional Skat deal pattern: 3 cards each, 2 to skat, 4 each, 3 each.
// The pattern matters culturally; the resulting distribution is what counts.
export function deal(rng: () => number): Deal {
  const deck = shuffle(freshDeck(), rng);
  const hands: [Card[], Card[], Card[]] = [[], [], []];
  let i = 0;
  const take = (n: number) => deck.slice(i, (i += n));

  for (let p = 0; p < 3; p++) hands[p].push(...take(3));
  const skat = take(2) as [Card, Card];
  for (let p = 0; p < 3; p++) hands[p].push(...take(4));
  for (let p = 0; p < 3; p++) hands[p].push(...take(3));

  return { hands, skat };
}
