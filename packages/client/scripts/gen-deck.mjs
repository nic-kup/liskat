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

const GLYPH = { C: '♣', S: '♠', H: '♥', D: '♦' };
const COLOR = { C: '#1a1a1a', S: '#1f7a1f', H: '#d11', D: '#e6820a' };
const FONT = "'DejaVu Sans','Arial Unicode MS','Segoe UI Symbol',sans-serif";

function cardSvg(suit, rank) {
  const color = COLOR[suit];
  const g = GLYPH[suit];
  const courts = { J: 'B', Q: 'D', K: 'K', A: 'A' }; // German labels: Bube, Dame, König, As
  const centerLabel = courts[rank] ?? rank;
  const isCourt = rank === 'J' || rank === 'Q' || rank === 'K';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" font-family="${FONT}">
  <rect x="4" y="4" width="242" height="342" rx="20" ry="20" fill="#fffdf7" stroke="#d8d2c4" stroke-width="2"/>
  <g fill="${color}" text-anchor="middle">
    <text x="34" y="46" font-size="40" font-weight="700">${rank}</text>
    <text x="34" y="84" font-size="34">${g}</text>
    <g transform="rotate(180 216 312)">
      <text x="216" y="290" font-size="40" font-weight="700">${rank}</text>
      <text x="216" y="328" font-size="34">${g}</text>
    </g>
    <text x="125" y="${isCourt ? 178 : 205}" font-size="${isCourt ? 96 : 150}" font-weight="700">${centerLabel}</text>
    ${isCourt ? `<text x="125" y="270" font-size="86">${g}</text>` : ''}
  </g>
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
