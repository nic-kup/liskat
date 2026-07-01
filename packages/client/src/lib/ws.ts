// The single WebSocket connection to the game server, exposed as a Svelte
// store. Components read `conn` and call the action helpers.

import { writable } from 'svelte/store';
import type { Card, Contract, Announcements, MatchFormat } from '@liskat/engine';
import type { LobbyEntry, TableView, ReviewDeal } from './types.ts';

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

// The deal the user is currently reviewing (post-game step-through), or null.
export const reviewStore = writable<ReviewDeal | null>(null);

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
// The last action we sent that we're not yet sure the server received. On a
// half-open socket a `send` succeeds locally but the bytes never arrive, so the
// move is silently lost; the watchdog reconnects but the move is gone. We hold
// the action here and replay it (flagged `resend`) once a fresh socket opens.
// Cleared as soon as any authoritative `table` view comes back, since that
// proves the round-trip completed (or re-syncs us if it didn't apply).
let pendingAction: { t: 'action'; action: unknown } | null = null;
// Reconnect backoff and a grace period so a brief drop+reconnect doesn't flip
// the status indicator to "connecting".
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectGrace: ReturnType<typeof setTimeout> | null = null;
const DISCONNECT_GRACE_MS = 4000;
const MAX_QUEUE = 64; // cap unsent messages so an extended outage can't grow it unbounded

// Client-side liveness watchdog. The browser does not reliably fire `onclose`
// for a half-open socket (laptop sleep/wake, Wi-Fi<->cellular handoff, a proxy
// dropping the path): readyState stays OPEN, so bot-move broadcasts silently
// stop arriving and a reload is the only way to recover. To catch this, we send
// an app-level `ping` on a timer and force a reconnect if nothing comes back.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastRecv = 0; // timestamp of the last message received on the live socket
const PING_MS = 15000; // how often we probe (server also pings every 25s)
const STALE_MS = 40000; // no traffic for this long => assume the socket is dead

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ws: WebSocket): void {
  stopHeartbeat();
  lastRecv = Date.now();
  heartbeatTimer = setInterval(() => {
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }
    if (Date.now() - lastRecv > STALE_MS) {
      // Silent for too long: the socket is half-open. Close it to trigger
      // `onclose`, which stops this timer and schedules a reconnect.
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      return;
    }
    try {
      ws.send(JSON.stringify({ t: 'ping' }));
    } catch {
      /* socket closing */
    }
  }, PING_MS);
}

// Called when the tab becomes visible or the network comes back. These are the
// moments a half-open socket is most likely, and the moments the user is most
// likely watching, so recover fast instead of waiting out the heartbeat.
function nudge(): void {
  if (!socket) {
    // Reconnect now rather than waiting out the backoff.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectDelay = 1000;
    connect();
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    const ws = socket;
    const sentAt = Date.now();
    try {
      ws.send(JSON.stringify({ t: 'ping' }));
    } catch {
      /* socket closing */
    }
    // If no reply (or any message) arrives shortly, the socket is dead: drop it.
    setTimeout(() => {
      if (socket === ws && ws.readyState === WebSocket.OPEN && lastRecv < sentAt) {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
    }, 3000);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') nudge();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', nudge);
}

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
    startHeartbeat(ws);
    conn.update((s) => ({ ...s, connected: true }));
    // Re-establish identity before anything else: a logged-in session takes
    // precedence; otherwise reclaim the anonymous seat we last held.
    const token = ls(SESSION_KEY);
    const pid = ls(PID_KEY);
    if (token) ws.send(JSON.stringify({ t: 'auth', token }));
    else if (pid) ws.send(JSON.stringify({ t: 'resume', playerId: pid }));
    for (const m of queue) ws.send(m);
    queue = [];
    // Replay an action that may have been lost on the socket that just died.
    // `resend` tells the server to drop it silently if it already applied.
    if (pendingAction) ws.send(JSON.stringify({ ...pendingAction, resend: true }));
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    stopHeartbeat();
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
    lastRecv = Date.now(); // any traffic proves the socket is alive
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.t === 'pong') return; // liveness reply; the timestamp above is all we need
    if (msg.t === 'review') {
      reviewStore.set(msg.data as ReviewDeal);
      return;
    }
    // Any authoritative table state ends the uncertainty about our last action:
    // it either reflects the move or re-syncs us to the truth. Either way there's
    // nothing left to replay. (`left` means we're no longer at a table at all.)
    if (msg.t === 'table' || msg.t === 'left') pendingAction = null;
    if (msg.t === 'left') reviewStore.set(null); // no table, no review
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
  // Remember the latest action so we can replay it if this send is lost to a
  // half-open socket. A new action supersedes the previous one.
  if (obj && typeof obj === 'object' && (obj as { t?: string }).t === 'action') {
    pendingAction = obj as { t: 'action'; action: unknown };
  }
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
  pendingAction = null; // a queued move must not follow us across identities
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

// Start a solo practice game against two bots (unrated, no queue). With tutorial=true the
// game is untimed and the server attaches coaching hints to your view (the how-to tutorial).
export function practiceMatch(format?: MatchFormat, tutorial = false): void {
  send({ t: 'practiceMatch', format, tutorial });
}

export function cancelMatch(): void {
  send({ t: 'cancelMatch' });
}

// Fill an open seat at your private table with a bot.
export function addBot(): void {
  send({ t: 'addBot' });
}

export function createTable(visibility: 'private' | 'public', format: MatchFormat, timed = true): void {
  send({ t: 'createTable', visibility, format, timed });
}

export function joinTable(tableId: string): void {
  send({ t: 'joinTable', tableId });
}

export function leaveTable(): void {
  pendingAction = null; // don't replay a move into a table we're leaving
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

// Ask the server for a step-through review of a finished deal (1-based deal #);
// the reply lands in reviewStore. closeReview() dismisses the overlay locally.
export function requestReview(deal: number): void {
  send({ t: 'reviewDeal', deal });
}
export function closeReview(): void {
  reviewStore.set(null);
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
