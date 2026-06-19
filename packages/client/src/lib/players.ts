// A stable visual identity per player so the two opponents (and you) are easy
// to tell apart — at the table and in chat.
//
// Colour + shape together (redundant encoding) so it stays legible for
// colour-blind players. The two opponents use orange and blue, the safest
// distinct pair from the Okabe-Ito colour-blind palette; you are yellow.

export interface Identity {
  color: string;
  marker: string;
}

const YOU: Identity = { color: '#f0e442', marker: '◆' }; // yellow diamond
const OPPONENTS: Identity[] = [
  { color: '#e69f00', marker: '●' }, // orange circle
  { color: '#56b4e9', marker: '▲' }, // blue triangle
];

// Identity for a seat, given which seat is "you". Opponents are assigned in
// stable slot order, so a player keeps the same colour all match.
export function identityForSlot(slot: number, youSlot: number | null): Identity {
  if (slot === youSlot) return YOU;
  const others = [0, 1, 2].filter((s) => s !== youSlot);
  const idx = others.indexOf(slot);
  return OPPONENTS[idx] ?? OPPONENTS[0];
}
