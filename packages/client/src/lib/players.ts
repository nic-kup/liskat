// A stable visual identity per seat so players are easy to tell apart — at the
// table, in chat, and in the history. Assigned by absolute seat slot so every
// player sees the same colour+shape for a given player (consistent across all
// perspectives).
//
// Colour + shape together (redundant encoding) keeps it legible for colour-blind
// players: orange, blue and yellow are mutually distinct across the common
// colour-vision deficiencies and read well on the dark felt.

export interface Identity {
  color: string;
  marker: string;
}

const IDENTITIES: Identity[] = [
  { color: '#e69f00', marker: '●' }, // seat 0 — orange circle
  { color: '#56b4e9', marker: '▲' }, // seat 1 — blue triangle
  { color: '#f0e442', marker: '◆' }, // seat 2 — yellow diamond
];

export function identityForSlot(slot: number): Identity {
  return IDENTITIES[slot] ?? IDENTITIES[0];
}
