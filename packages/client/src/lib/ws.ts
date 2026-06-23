// The single WebSocket connection to the game server, exposed as a Svelte
// store. Components read `conn` and call the action helpers.

import { writable } from 'svelte/store';
import type { Card, Contract, Announcements, MatchFormat } from '@liskat/engine';
import type { LobbyEntry, TableView } from './types.ts';

export interface ConnState {
  connected: boolean;
  playerId: string | null;
  nick: string;
  account: string | null; // logged-in username, or null when anonymous
  searching: MatchFormat | null; // the format we're queued for, or null
  queues: Record<string, number>; // live matchmaking-queue sizes per format key
  tables: LobbyEntry[];
  view: TableView | null;
  error: string | null;
}

// Persisted so a page reload can reconnect to the same seat instead of being
// dropped from the game.
const PID_KEY = 'liskat.pid';
const SESSION_KEY = 'liskat.session'; // session token for a logged-in account
const ACCOUNT_KEY = 'liskat.account'; // remembered username, for instant UI on load

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function setLs(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
}

export const conn = writable<ConnState>({
  connected: false,
  playerId: null,
  nick: '',
  account: ls(ACCOUNT_KEY),
  searching: null,
  queues: {},
  tables: [],
  view: null,
  error: null,
});

let socket: WebSocket | null = null;
let queue: string[] = [];
// Reconnect backoff and a grace period so a brief drop+reconnect doesn't flip
// the status indicator to "connecting".
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectGrace: ReturnType<typeof setTimeout> | null = null;
const DISCONNECT_GRACE_MS = 4000;
const MAX_QUEUE = 64; // cap unsent messages so an extended outage can't grow it unbounded

function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

// Schedules a single reconnect attempt with backoff. Guards against stacking
// multiple timers (which would spawn duplicate sockets, each scheduling more).
function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), 10000);
}

export function connect(): void {
  // A live socket or a pending reconnect already covers us; never open a second.
  if (socket || reconnectTimer) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    // Constructor can throw on a malformed URL; retry rather than stall forever.
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (disconnectGrace) {
      clearTimeout(disconnectGrace);
      disconnectGrace = null;
    }
    reconnectDelay = 1000;
    conn.update((s) => ({ ...s, connected: true }));
    // Re-establish identity before anything else: a logged-in session takes
    // precedence; otherwise reclaim the anonymous seat we last held.
    const token = ls(SESSION_KEY);
    const pid = ls(PID_KEY);
    if (token) ws.send(JSON.stringify({ t: 'auth', token }));
    else if (pid) ws.send(JSON.stringify({ t: 'resume', playerId: pid }));
    for (const m of queue) ws.send(m);
    queue = [];
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    ws.onmessage = null; // detach the handler closure on the dead socket
    // Only show "connecting" if we don't get back within the grace window.
    if (!disconnectGrace) {
      disconnectGrace = setTimeout(() => {
        disconnectGrace = null;
        conn.update((s) => ({ ...s, connected: false }));
      }, DISCONNECT_GRACE_MS);
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    /* swallow; onclose drives the reconnect */
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
          setLs(PID_KEY, msg.playerId);
          return { ...s, playerId: msg.playerId };
        case 'tables':
          return { ...s, tables: msg.tables };
        case 'queued':
          return { ...s, searching: msg.format as MatchFormat };
        case 'unqueued':
          return { ...s, searching: null };
        case 'queues':
          return { ...s, queues: msg.counts as Record<string, number> };
        case 'table':
          return { ...s, view: msg.view as TableView, searching: null, error: null };
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
  else {
    queue.push(data);
    if (queue.length > MAX_QUEUE) queue.shift(); // drop the oldest unsent message
  }
}

export function setNick(nick: string): void {
  conn.update((s) => ({ ...s, nick }));
  send({ t: 'hello', nick });
}

// ---- accounts --------------------------------------------------------------

interface AuthResponse {
  ok: boolean;
  token?: string;
  username?: string;
  error?: string;
}

async function authPost(path: string, body: object): Promise<AuthResponse> {
  try {
    const res = await fetch(`/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as AuthResponse;
  } catch {
    return { ok: false, error: 'Network error.' };
  }
}

// On success, persists the session and binds the live socket to the account.
function onAuthed(r: AuthResponse): void {
  if (!r.ok || !r.token || !r.username) return;
  setLs(SESSION_KEY, r.token);
  setLs(ACCOUNT_KEY, r.username);
  conn.update((s) => ({ ...s, account: r.username!, nick: r.username!, error: null }));
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'auth', token: r.token }));
}

export async function register(username: string, password: string, email?: string): Promise<AuthResponse> {
  const r = await authPost('register', { username, password, email });
  onAuthed(r);
  return r;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const r = await authPost('login', { username, password });
  onAuthed(r);
  return r;
}

export interface RatingEntry {
  rating: number;
  games: number;
}
export interface MatchPlayerResult {
  userId: string;
  username: string;
  score: number;
  place: number;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
}
export interface MatchRecord {
  id: string;
  type: string;
  ts: string;
  ranked: boolean;
  results: MatchPlayerResult[];
}
export interface Profile {
  ok: boolean;
  username?: string;
  ratings?: Record<string, RatingEntry>;
  history?: MatchRecord[];
  error?: string;
}

export interface DealReplay {
  deal: number;
  dealerSlot: number;
  hands: string[][];
  skat: string[];
  bids: { slot: number; kind: 'bid' | 'hold' | 'pass'; value?: number }[];
  declarerSlot: number | null;
  tookSkat: boolean;
  discard: string[] | null;
  contract: { type: 'suit' | 'grand' | 'null'; suit?: string } | null;
  ouvert?: boolean;
  tricks: { leader: number; cards: string[]; winner: number }[];
  result: { won: boolean; value: number; schneider: boolean; schwarz: boolean; cardPoints: number | null } | null;
  passedIn: boolean;
  scores: number[];
}
export interface MatchDetail {
  id: string;
  type: string;
  ts: string;
  ranked: boolean;
  players: { slot: number; username: string; account: boolean }[];
  deals: DealReplay[];
}

export async function fetchProfile(): Promise<Profile> {
  const token = ls(SESSION_KEY);
  if (!token) return { ok: false, error: 'Not logged in.' };
  try {
    const res = await fetch('/auth/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return (await res.json()) as Profile;
  } catch {
    return { ok: false, error: 'Network error.' };
  }
}

export async function fetchMatch(id: string): Promise<MatchDetail | null> {
  const token = ls(SESSION_KEY);
  if (!token) return null;
  try {
    const res = await fetch('/auth/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, id }),
    });
    const data = await res.json();
    return data.ok ? (data.detail as MatchDetail) : null;
  } catch {
    return null;
  }
}

export function logout(): void {
  const token = ls(SESSION_KEY);
  if (token) void authPost('logout', { token });
  setLs(SESSION_KEY, null);
  setLs(ACCOUNT_KEY, null);
  // Forget the stored player id too: it points at the account's seat, so without
  // clearing it the reconnect below would `resume` straight back into the
  // just-logged-out identity. Clearing it forces a fresh anonymous welcome.
  setLs(PID_KEY, null);
  conn.update((s) => ({ ...s, account: null, playerId: null, view: null }));
  // Drop the account identity on the server by reconnecting anonymously.
  if (socket) socket.close();
}

export function quickMatch(format?: MatchFormat): void {
  send({ t: 'quickMatch', format });
}

// Start a solo practice game against two bots (unrated, no queue).
export function practiceMatch(format?: MatchFormat): void {
  send({ t: 'practiceMatch', format });
}

export function cancelMatch(): void {
  send({ t: 'cancelMatch' });
}

export function createTable(visibility: 'private' | 'public', format: MatchFormat, timed = true): void {
  send({ t: 'createTable', visibility, format, timed });
}

export function joinTable(tableId: string): void {
  send({ t: 'joinTable', tableId });
}

export function leaveTable(): void {
  send({ t: 'leaveTable' });
  // Drop any ?table=… from the URL so a reload doesn't rejoin the table we left.
  try {
    if (location.search) history.replaceState(null, '', location.pathname);
  } catch {
    /* history API unavailable */
  }
}

export function listTables(): void {
  send({ t: 'listTables' });
}

export function sendChat(text: string): void {
  send({ t: 'chat', text });
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
