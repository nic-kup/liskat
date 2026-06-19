// Per-account Elo ratings and match history. Skat is three-handed, so a single
// match doesn't map onto two-player Elo cleanly: three equal players each win
// only 1/3 of the time. We use the pairwise-duel decomposition — a 3-player
// match is the three head-to-head duels it contains:
//
//   E_i = Σ_{j≠i} 1/(1+10^((R_j-R_i)/400))   // opponents you're expected to beat (0..2)
//   S_i = Σ_{j≠i} {1 above, ½ tie, 0 below}  // opponents you actually beat (0..2)
//   R_i += K·(S_i - E_i)
//
// For equal players E_i = 1, so finishing 1st/2nd/3rd gives +K / 0 / −K — each
// 1/3 of the time, zero-sum across the table, and the full ranking counts.
//
// Ratings are kept per match type (the 5 formats). Persisted as JSON under
// data/ (gitignored), swappable for a database later.

import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './datadir.ts';
import { deleteMatchDetail } from './history.ts';

const RATINGS_FILE = join(DATA_DIR, 'ratings.json');
const MATCHES_FILE = join(DATA_DIR, 'matches.json');

export const MATCH_TYPES = ['deals-6', 'deals-12', 'deals-36', 'race-250', 'race-1000'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

const START = 1500;
const PROVISIONAL_GAMES = 10;
const K_PROVISIONAL = 40;
const K_ESTABLISHED = 24;
const MAX_MATCHES = 5000;

interface Rating {
  rating: number;
  games: number;
}
type RatingsByType = Partial<Record<MatchType, Rating>>;

export interface MatchPlayerResult {
  userId: string; // "" for an anonymous player
  username: string;
  score: number;
  place: number; // 1 = best (ties share a place)
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
}
export interface MatchRecord {
  id: string;
  type: string; // format key, e.g. "deals-12"
  ts: string;
  ranked: boolean; // whether it affected Elo
  results: MatchPlayerResult[];
}

export interface MatchPlayerInput {
  userId: string | null;
  username: string;
  score: number;
}

const ratings = new Map<string, RatingsByType>(); // userId -> per-type rating
let matches: MatchRecord[] = [];

// ---- persistence -----------------------------------------------------------

async function atomicWrite(file: string, data: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

async function saveRatings(): Promise<void> {
  await atomicWrite(RATINGS_FILE, JSON.stringify(Object.fromEntries(ratings)));
}
async function saveMatches(): Promise<void> {
  await atomicWrite(MATCHES_FILE, JSON.stringify(matches));
}

export async function initRatings(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(RATINGS_FILE, 'utf8')) as Record<string, RatingsByType>;
    for (const [id, byType] of Object.entries(raw)) ratings.set(id, byType);
  } catch {
    /* no ratings yet */
  }
  try {
    matches = JSON.parse(await readFile(MATCHES_FILE, 'utf8')) as MatchRecord[];
  } catch {
    matches = [];
  }
}

// ---- rating math -----------------------------------------------------------

const expectedPair = (rA: number, rB: number): number => 1 / (1 + Math.pow(10, (rB - rA) / 400));
const kFor = (games: number): number => (games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED);

function ratingEntry(userId: string, type: MatchType): Rating {
  return ratings.get(userId)?.[type] ?? { rating: START, games: 0 };
}

export function ratingOf(userId: string, type: MatchType): number {
  return ratingEntry(userId, type).rating;
}

// All five ratings for an account, defaulting unplayed types to the start value.
export function ratingsFor(userId: string): Record<MatchType, Rating> {
  const out = {} as Record<MatchType, Rating>;
  for (const t of MATCH_TYPES) out[t] = { ...ratingEntry(userId, t) };
  return out;
}

export function historyFor(userId: string, limit = 50): MatchRecord[] {
  const mine = matches.filter((m) => m.results.some((r) => r.userId === userId));
  return mine.slice(-limit).reverse();
}

// A match summary by id, or undefined.
export function matchById(id: string): MatchRecord | undefined {
  return matches.find((m) => m.id === id);
}

export function matchCount(): number {
  return matches.length;
}
export function ratedPlayerCount(): number {
  return ratings.size;
}

// Docks a player's rating for a match type (e.g. forfeiting a ranked game by
// leaving mid-match). Floored so it can't go absurdly low. Returns points lost.
export async function applyPenalty(userId: string, type: MatchType, amount: number): Promise<number> {
  if (!MATCH_TYPES.includes(type)) return 0;
  const e = ratingEntry(userId, type);
  const after = Math.max(100, e.rating - amount);
  const byType = ratings.get(userId) ?? {};
  byType[type] = { rating: after, games: e.games };
  ratings.set(userId, byType);
  await saveRatings();
  return e.rating - after;
}

// Records a finished match into the history. When `ranked` is set (a rated game
// where every seat is an account, with a standard format), it also updates Elo
// using the pairwise method; otherwise it just stores the placements. Returns
// the summary record (its id keys the on-disk replay detail).
export async function recordMatch(typeKey: string, ranked: boolean, players: MatchPlayerInput[]): Promise<MatchRecord | null> {
  if (players.length !== 3) return null;
  const places = players.map((p) => 1 + players.filter((o) => o.score > p.score).length);
  const ratedType = ranked && (MATCH_TYPES as readonly string[]).includes(typeKey) ? (typeKey as MatchType) : null;

  const before = players.map((p) => (ratedType && p.userId ? ratingEntry(p.userId, ratedType) : { rating: START, games: 0 }));
  let deltas = players.map(() => 0);

  if (ratedType) {
    deltas = players.map((p, i) => {
      let expected = 0;
      let actual = 0;
      for (let j = 0; j < players.length; j++) {
        if (j === i) continue;
        expected += expectedPair(before[i].rating, before[j].rating);
        if (places[i] < places[j]) actual += 1;
        else if (places[i] === places[j]) actual += 0.5;
      }
      return Math.round(kFor(before[i].games) * (actual - expected));
    });
    players.forEach((p, i) => {
      if (!p.userId) return;
      const byType = ratings.get(p.userId) ?? {};
      byType[ratedType] = { rating: before[i].rating + deltas[i], games: before[i].games + 1 };
      ratings.set(p.userId, byType);
    });
  }

  const results: MatchPlayerResult[] = players.map((p, i) => ({
    userId: p.userId ?? '',
    username: p.username,
    score: p.score,
    place: places[i],
    ratingBefore: before[i].rating,
    ratingAfter: before[i].rating + deltas[i],
    delta: deltas[i],
  }));

  const record: MatchRecord = { id: `m_${randomBytes(6).toString('hex')}`, type: typeKey, ts: new Date().toISOString(), ranked: !!ratedType, results };
  matches.push(record);
  if (matches.length > MAX_MATCHES) {
    const evicted = matches.slice(0, matches.length - MAX_MATCHES);
    matches = matches.slice(-MAX_MATCHES);
    for (const m of evicted) void deleteMatchDetail(m.id); // drop the replay file too
  }

  await saveRatings();
  await saveMatches();
  return record;
}
