// View shapes the server sends us. Mirrors packages/server/src/table.ts and
// protocol.ts. Kept as a thin local copy to avoid importing server runtime.

import type { Card, Contract, Announcements, MatchFormat, Seat } from '@liskat/engine';

export type { Card, Contract, Announcements, MatchFormat, Seat };

export interface LobbyEntry {
  id: string;
  hostNick: string;
  seated: number;
  format: MatchFormat;
}

export interface PlayerView {
  slot: number;
  role: Seat;
  nick: string | null;
  occupied: boolean;
  you: boolean;
}

export interface HistoryEntry {
  deal: number;
  declarerSlot: number | null;
  short: string | null;
  won: boolean | null;
  value: number;
  passedIn: boolean;
  scores: number[];
}

export interface RoundView {
  phase: 'bidding' | 'declaring' | 'playing' | 'finished';
  bidding?: { awaiting: string; askerSlot: number; responderSlot: number | null; currentBid: number; lastBidderSlot: number | null; lastActions: ({ kind: 'bid' | 'hold' | 'pass'; value?: number } | null)[] };
  declarerSlot: number | null;
  bid: number;
  tookSkat: boolean;
  declareStep: 'choose' | 'discard' | 'contract' | 'done';
  contract: Contract | null;
  announcements: Announcements;
  turnSlot: number;
  leaderSlot: number;
  trick: { slot: number; card: Card }[];
  trickComplete: boolean;
  lastTrick: { slot: number; card: Card }[];
  lastTrickWinnerSlot: number | null;
  trickCount: number;
  handCounts: number[];
  yourHand: Card[];
  legal: Card[];
  passedIn: boolean;
  result: { won: boolean; value: number; multiplier: number; schneider: boolean; schwarz: boolean } | null;
  skat: [Card, Card] | null;
}

export interface TableView {
  id: string;
  visibility: 'private' | 'public';
  format: MatchFormat;
  status: 'waiting' | 'playing' | 'between' | 'over';
  dealIndex: number;
  youSlot: number | null;
  players: PlayerView[];
  match: { scores: number[]; dealsPlayed: number; finished: boolean; winner: number | null } | null;
  round?: RoundView;
  chat: { nick: string; slot: number; text: string }[];
  history: HistoryEntry[];
}
