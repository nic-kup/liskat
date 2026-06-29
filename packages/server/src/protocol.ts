// The wire protocol between client and server. All messages are JSON objects
// with a `t` (type) discriminator.

import type { Card, Contract, Announcements, MatchFormat } from '@liskat/engine';

// ---- Client -> Server ------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; nick: string }
  | { t: 'resume'; playerId: string | null }
  | { t: 'auth'; token: string }
  | { t: 'createTable'; visibility: 'private' | 'public'; format: MatchFormat; timed?: boolean }
  | { t: 'joinTable'; tableId: string }
  | { t: 'quickMatch'; format?: MatchFormat }
  | { t: 'practiceMatch'; format?: MatchFormat } // start a solo game against two bots
  | { t: 'addBot' } // fill an open seat at your private table with a bot
  | { t: 'cancelMatch' }
  | { t: 'leaveTable' }
  | { t: 'listTables' }
  | { t: 'chat'; text: string }
  | { t: 'ping' } // client liveness probe; server replies with `pong`
  | { t: 'action'; action: ClientAction };

// The seat is supplied by the server (derived from who you are), so clients
// send actions without it.
export type ClientAction =
  | { type: 'bid'; value: number }
  | { type: 'hold' }
  | { type: 'pass' }
  | { type: 'takeSkat' }
  | { type: 'playHand' }
  | { type: 'discard'; cards: [Card, Card] }
  | { type: 'declareContract'; contract: Contract; announcements?: Partial<Announcements> }
  | { type: 'playCard'; card: Card };

// ---- Server -> Client ------------------------------------------------------

export type ServerMessage =
  | { t: 'welcome'; playerId: string }
  | { t: 'tables'; tables: LobbyEntry[] }
  | { t: 'table'; view: unknown } // a personalized TableView (see view.ts)
  | { t: 'queued'; format: MatchFormat } // you're in the matchmaking queue
  | { t: 'unqueued' } // you left the queue
  | { t: 'queues'; counts: Record<string, number> } // live queue sizes per format
  | { t: 'left' }
  | { t: 'pong' } // reply to a client `ping`, so the client can detect a dead socket
  | { t: 'error'; msg: string };

export interface LobbyEntry {
  id: string;
  hostNick: string;
  seated: number; // 0..3
  format: MatchFormat;
}
