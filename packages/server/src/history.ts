// Full match replays, stored compactly one file per match under data/matches/.
// Cards are kept as their short string ids (e.g. "CA", "C10"), and only the
// match summaries live in memory (see ratings.ts) — these detail files are read
// on demand when a player drills into a match.

import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './datadir.ts';

const DETAIL_DIR = join(DATA_DIR, 'matches');

export interface DealReplay {
  deal: number; // 1-based deal number within the match
  dealerSlot: number;
  hands: string[][]; // the 10 dealt cards per slot (card ids)
  skat: string[]; // the two dealt skat cards
  bids: { slot: number; kind: 'bid' | 'hold' | 'pass'; value?: number }[];
  declarerSlot: number | null;
  tookSkat: boolean;
  discard: string[] | null; // two cards the declarer put down (if they took the skat)
  contract: { type: 'suit' | 'grand' | 'null'; suit?: string } | null;
  ouvert?: boolean;
  tricks: { leader: number; cards: string[]; winner: number }[]; // cards in play order from the leader
  result: { won: boolean; value: number; schneider: boolean; schwarz: boolean; cardPoints: number | null } | null;
  passedIn: boolean;
  scores: number[]; // running match scores after this deal
}

export interface MatchDetail {
  id: string;
  type: string;
  ts: string;
  ranked: boolean;
  players: { slot: number; username: string; account: boolean }[];
  deals: DealReplay[];
}

const safeId = (id: string): boolean => /^[A-Za-z0-9_]+$/.test(id);

export async function writeMatchDetail(detail: MatchDetail): Promise<void> {
  if (!safeId(detail.id)) return;
  await mkdir(DETAIL_DIR, { recursive: true });
  const file = join(DETAIL_DIR, `${detail.id}.json`);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(detail), 'utf8');
  await rename(tmp, file);
}

export async function readMatchDetail(id: string): Promise<MatchDetail | null> {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(await readFile(join(DETAIL_DIR, `${id}.json`), 'utf8')) as MatchDetail;
  } catch {
    return null;
  }
}

export async function deleteMatchDetail(id: string): Promise<void> {
  if (!safeId(id)) return;
  try {
    await rm(join(DETAIL_DIR, `${id}.json`));
  } catch {
    /* already gone */
  }
}
