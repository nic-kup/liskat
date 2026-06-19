// The wire protocol between client and server. All messages are JSON objects
// with a `t` (type) discriminator.

import type { Card, Contract, Announcements, MatchFormat } from '@liskat/engine';

// ---- Client -> Server ------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; nick: string }
  | { t: 'resume'; playerId: string | null }
  | { t: 'createTable'; visibility: 'private' | 'public'; format: MatchFormat }
  | { t: 'joinTable'; tableId: string }
  | { t: 'quickMatch'; format?: MatchFormat }
  | { t: 'leaveTable' }
  | { t: 'listTables' }
  | { t: 'chat'; text: string }
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
  | { t: 'left' }
  | { t: 'error'; msg: string };

export interface LobbyEntry {
  id: string;
  hostNick: string;
  seated: number; // 0..3
  format: MatchFormat;
}
