// The single WebSocket connection to the game server, exposed as a Svelte
// store. Components read `conn` and call the action helpers.

import { writable } from 'svelte/store';
import type { Card, Contract, Announcements, MatchFormat } from '@liskat/engine';
import type { LobbyEntry, TableView } from './types.ts';

export interface ConnState {
  connected: boolean;
  playerId: string | null;
  nick: string;
  tables: LobbyEntry[];
  view: TableView | null;
  error: string | null;
}

export const conn = writable<ConnState>({
  connected: false,
  playerId: null,
  nick: '',
  tables: [],
  view: null,
  error: null,
});

let socket: WebSocket | null = null;
let queue: string[] = [];

function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(): void {
  if (socket) return;
  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.onopen = () => {
    conn.update((s) => ({ ...s, connected: true }));
    for (const m of queue) ws.send(m);
    queue = [];
  };

  ws.onclose = () => {
    socket = null;
    conn.update((s) => ({ ...s, connected: false }));
    // Try to reconnect after a short delay.
    setTimeout(connect, 1500);
  };

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    conn.update((s) => {
      switch (msg.t) {
        case 'welcome':
          return { ...s, playerId: msg.playerId };
        case 'tables':
          return { ...s, tables: msg.tables };
        case 'table':
          return { ...s, view: msg.view as TableView, error: null };
        case 'left':
          return { ...s, view: null };
        case 'error':
          return { ...s, error: msg.msg };
        default:
          return s;
      }
    });
  };
}

function send(obj: unknown): void {
  const data = JSON.stringify(obj);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
  else queue.push(data);
}

export function setNick(nick: string): void {
  conn.update((s) => ({ ...s, nick }));
  send({ t: 'hello', nick });
}

export function quickMatch(format?: MatchFormat): void {
  send({ t: 'quickMatch', format });
}

export function createTable(visibility: 'private' | 'public', format: MatchFormat): void {
  send({ t: 'createTable', visibility, format });
}

export function joinTable(tableId: string): void {
  send({ t: 'joinTable', tableId });
}

export function leaveTable(): void {
  send({ t: 'leaveTable' });
}

export function listTables(): void {
  send({ t: 'listTables' });
}

// ---- round actions ---------------------------------------------------------

export function bid(value: number): void {
  send({ t: 'action', action: { type: 'bid', value } });
}
export function hold(): void {
  send({ t: 'action', action: { type: 'hold' } });
}
export function pass(): void {
  send({ t: 'action', action: { type: 'pass' } });
}
export function takeSkat(): void {
  send({ t: 'action', action: { type: 'takeSkat' } });
}
export function playHand(): void {
  send({ t: 'action', action: { type: 'playHand' } });
}
export function discard(cards: [Card, Card]): void {
  send({ t: 'action', action: { type: 'discard', cards } });
}
export function declareContract(contract: Contract, announcements?: Partial<Announcements>): void {
  send({ t: 'action', action: { type: 'declareContract', contract, announcements } });
}
export function playCard(card: Card): void {
  send({ t: 'action', action: { type: 'playCard', card } });
}
