// The legal Skat bidding values, ascending. A bid is a number from this
// sequence; the highest bidder becomes declarer and must then play a game
// worth at least their bid or they lose ("overbid").
//
// The sequence is base-value * multiplier for every reachable combination,
// sorted and de-duplicated. The low end (18..) is what almost every hand uses.
export const BID_VALUES: number[] = (() => {
  const bases = [9, 10, 11, 12, 24]; // diamonds..clubs, grand
  const values = new Set<number>([23, 35, 46, 59]); // the four null values
  for (const base of bases) {
    for (let mult = 2; mult <= 18; mult++) values.add(base * mult);
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
