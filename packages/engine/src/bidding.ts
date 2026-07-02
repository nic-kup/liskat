// The legal Skat bidding values, ascending. A bid is a number from this
// sequence; the highest bidder becomes declarer and must then play a game
// worth at least their bid or they lose ("overbid").
//
// The sequence is base-value * multiplier for every reachable combination,
// sorted and de-duplicated. The low end (18..) is what almost every hand uses.
export const BID_VALUES: number[] = (() => {
  // Each game's max multiplier = matadors + 1 (game) + hand + schneider +
  // schneider-announced + schwarz + schwarz-announced + ouvert. A suit game has up
  // to 11 trumps (4 jacks + 7 of the suit) so its matadors cap at 11 -> max mult 18;
  // grand has only the 4 jacks as trumps, so its matadors cap at 4 -> max mult 11.
  // Generating grand up to 18 invents values (288..432) no game can ever pay.
  const bases: [number, number][] = [[9, 18], [10, 18], [11, 18], [12, 18], [24, 11]];
  const values = new Set<number>([23, 35, 46, 59]); // the four null values
  for (const [base, maxMult] of bases) {
    for (let mult = 2; mult <= maxMult; mult++) values.add(base * mult);
  }
  return [...values].sort((a, b) => a - b);
})();

export function nextBid(current: number): number | null {
  const next = BID_VALUES.find((v) => v > current);
  return next ?? null;
}

export function isLegalBid(value: number): boolean {
  return BID_VALUES.includes(value);
}
