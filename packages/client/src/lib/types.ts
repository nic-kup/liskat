// View shapes the server sends us. Mirrors packages/server/src/table.ts and
// protocol.ts. Kept as a thin local copy to avoid importing server runtime.

import type { Card, Contract, Announcements, MatchFormat, Seat, BotDifficulty } from '@liskat/engine';

export type { Card, Contract, Announcements, MatchFormat, Seat, BotDifficulty };

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

// Post-game review of one finished deal (mirrors packages/server/src/review.ts).
// Everything is slot-indexed and face-up; the client just renders + steps it.
export interface ReviewPly {
  trick: number; // 0-based trick index
  pos: number; // 0..2 position within the trick
  slot: number; // who played this card
  card: string; // card id played
  bestCard?: string; // the card the bot would have played (absent when only one legal card)
  bestFeature?: string; // engine feature name behind the bot's pick, for the why-tooltip
}

export interface ReviewDeal {
  deal: number;
  dealerSlot: number;
  viewerSlot: number; // which slot is "you" (rendered as the bottom hand)
  hands: string[][]; // slot-indexed dealt hands (10 cards each)
  skat: string[];
  discard: string[] | null;
  tookSkat: boolean;
  declarerSlot: number | null;
  contract: { type: 'suit' | 'grand' | 'null'; suit?: string } | null;
  ouvert?: boolean;
  tricks: { leader: number; cards: string[]; winner: number }[];
  result: { won: boolean; value: number; schneider: boolean; schwarz: boolean; cardPoints: number | null } | null;
  scores: number[];
  passedIn: boolean;
  plies: ReviewPly[];
}

// Tutorial-only per-turn hint data the server attaches to the learner's round view.
export interface CoachView {
  bidCeil?: number;
  bidContractKey?: string;
  takeSkat?: boolean;
  discardIds?: string[];
  discardReason?: string;
  contractKey?: string;
  bestCards?: { id: string; feature: string }[];
  onlyOption?: boolean;
  eyesDeclarer?: number;
  eyesDefenders?: number;
  trumpsOut?: number;
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
  result: { won: boolean; value: number; multiplier: number; schneider: boolean; schwarz: boolean; cardPoints?: number } | null;
  skat: [Card, Card] | null;
  skatDealt: [Card, Card] | null;
  banks: number[];
  turnRemainingMs: number | null;
  coach?: CoachView;
}

export interface TableView {
  id: string;
  visibility: 'private' | 'public';
  format: MatchFormat;
  status: 'waiting' | 'playing' | 'between' | 'over';
  timed: boolean;
  tutorial: boolean;
  rated: boolean;
  ranked: boolean;
  dealIndex: number;
  youSlot: number | null;
  players: PlayerView[];
  match: { scores: number[]; dealsPlayed: number; finished: boolean; winner: number | null } | null;
  round?: RoundView;
  chat: { nick: string; slot: number; text: string }[];
  history: HistoryEntry[];
  rematchVotes: number[]; // slots that want to replay the finished match
}
