// Warm the browser cache with every card face up front so a hand never pops in
// card-by-card on the first deal. The whole French deck is ~18KB of tiny SVGs;
// fetching them once at startup means they're instant by the time you're seated.
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['C', 'D', 'H', 'S'];

export function preloadCards(deck = 'french'): void {
  const ids = ['back', ...SUITS.flatMap((s) => RANKS.map((r) => `${s}${r}`))];
  for (const id of ids) {
    const img = new Image();
    img.src = `/cards/${deck}/${id}.svg`;
  }
}
