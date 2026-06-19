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
          setLs(PID_KEY, msg.playerId);
          return { ...s, playerId: msg.playerId };
        case 'tables':
          return { ...s, tables: msg.tables };
        case 'queued':
          return { ...s, searching: msg.format as MatchFormat };
        case 'unqueued':
          return { ...s, searching: null };
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
  else queue.push(data);
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
  results: MatchPlayerResult[];
}
export interface Profile {
  ok: boolean;
  username?: string;
  ratings?: Record<string, RatingEntry>;
  history?: MatchRecord[];
  error?: string;
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

export function logout(): void {
  const token = ls(SESSION_KEY);
  if (token) void authPost('logout', { token });
  setLs(SESSION_KEY, null);
  setLs(ACCOUNT_KEY, null);
  conn.update((s) => ({ ...s, account: null }));
  // Drop the account identity on the server by reconnecting anonymously.
  if (socket) socket.close();
}

export function quickMatch(format?: MatchFormat): void {
  send({ t: 'quickMatch', format });
}

export function cancelMatch(): void {
  send({ t: 'cancelMatch' });
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
