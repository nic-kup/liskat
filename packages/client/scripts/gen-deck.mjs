// Generates a clean placeholder French-suited deck as SVG files, one per card,
// into public/cards/french/. This is the SAME directory layout that real card
// art will use, so swapping in nicer graphics later means dropping files in —
// no code changes. A German-suited deck lives in public/cards/german/.
//
// Style: German tournament four-colour deck (Vierfarbig) — clubs black,
// spades green, hearts red, diamonds orange — which makes suits easy to read.
//
// Run: npm run gen-deck

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'cards', 'french');
mkdirSync(outDir, { recursive: true });

const SUITS = ['C', 'S', 'H', 'D'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const COLOR = { C: '#1a1a1a', S: '#1f7a1f', H: '#d11', D: '#e6820a' };
const FONT = "'DejaVu Sans','Arial Unicode MS','Segoe UI Symbol',sans-serif";

// Suit pips drawn as SVG shapes (not Unicode glyphs) inside a 0..100 box, so
// the OS can't swap them for colour emoji (iOS does) and they always take the
// deck colour. Placed centred under the rank.
const SUIT_SHAPE = {
  H: '<path d="M50 86 C 18 64 4 46 4 28 C 4 15 14 6 26 6 C 36 6 44 12 50 22 C 56 12 64 6 74 6 C 86 6 96 15 96 28 C 96 46 82 64 50 86 Z"/>',
  D: '<path d="M50 2 L94 50 L50 98 L6 50 Z"/>',
  S: '<path d="M50 5 C 50 25 90 40 90 62 C 90 74 81 82 70 82 C 64 82 58 79 54 74 C 55 84 60 92 68 96 L32 96 C 40 92 45 84 46 74 C 42 79 36 82 30 82 C 19 82 10 74 10 62 C 10 40 50 25 50 5 Z"/>',
  C: '<circle cx="50" cy="30" r="17"/><circle cx="29" cy="52" r="17"/><circle cx="71" cy="52" r="17"/><path d="M50 46 C 47 64 41 78 33 96 L67 96 C 59 78 53 64 50 46 Z"/>',
};

function cardSvg(suit, rank) {
  const color = COLOR[suit];
  // French-suited deck uses J/Q/K/A. A single centred rank + suit pip.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" font-family="${FONT}">
  <rect x="4" y="4" width="242" height="342" rx="20" ry="20" fill="#fffdf7" stroke="#d8d2c4" stroke-width="2"/>
  <text x="125" y="170" font-size="116" font-weight="700" fill="${color}" text-anchor="middle">${rank}</text>
  <g transform="translate(75 198)" fill="${color}">${SUIT_SHAPE[suit]}</g>
</svg>`;
}

function backSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350">
  <defs>
    <pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="28" height="28" fill="#0e5a3a"/>
      <circle cx="14" cy="14" r="4" fill="#0c7a4d"/>
    </pattern>
  </defs>
  <rect x="4" y="4" width="242" height="342" rx="20" ry="20" fill="url(#p)" stroke="#063" stroke-width="2"/>
  <rect x="22" y="22" width="206" height="306" rx="12" ry="12" fill="none" stroke="#0c7a4d" stroke-width="3"/>
  <text x="125" y="195" text-anchor="middle" font-family="${FONT}" font-size="56" font-weight="800" fill="#eafff4">L</text>
</svg>`;
}

let count = 0;
for (const suit of SUITS) {
  for (const rank of RANKS) {
    writeFileSync(join(outDir, `${suit}${rank}.svg`), cardSvg(suit, rank));
    count++;
  }
}
writeFileSync(join(outDir, 'back.svg'), backSvg());
console.log(`wrote ${count} card faces + back to ${outDir}`);
