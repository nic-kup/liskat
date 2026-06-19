// Liskat game server. One WebSocket connection == one player. The server is
// authoritative: it owns the deck, validates every action through the engine,
// and sends each player a redacted view (you only see your own hand).

import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lobby } from './lobby.ts';
import type { Table } from './table.ts';
import type { ClientMessage, ServerMessage } from './protocol.ts';
import { recordFeedback } from './feedback.ts';
import { initAccounts, register, login, logout, userIdForToken, usernameForId, accountCount } from './accounts.ts';
import { initRatings, recordMatch, ratingsFor, historyFor, ratingOf, applyPenalty, matchCount, ratedPlayerCount, MATCH_TYPES, type MatchType } from './ratings.ts';
import { Matchmaker } from './matchmaker.ts';
import type { MatchFormat } from '@liskat/engine';

await initAccounts();
await initRatings();

const DEFAULT_FORMAT: MatchFormat = { kind: 'deals', deals: 12 };
const matchmaker = new Matchmaker();

const PORT = Number(process.env.PORT ?? 8080);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const startedAt = Date.now();
// How long a player's seat is held after their socket drops, so a page reload
// can reconnect to the same identity instead of being kicked from the game.
const RECONNECT_GRACE_MS = 60_000;
const lobby = new Lobby();

interface Client {
  id: string;
  nick: string;
  tableId: string | null;
  ws: WebSocket;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

const clients = new Map<WebSocket, Client>();
const byId = new Map<string, Client>();

let counter = 0;
function newId(): string {
  return `p${(++counter).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastTable(table: Table): void {
  for (const seat of table.seats) {
    if (!seat) continue;
    const c = byId.get(seat.id);
    if (c) send(c.ws, { t: 'table', view: table.view(seat.id) });
  }
}

function broadcastLobby(): void {
  const tables = lobby.publicList();
  for (const c of clients.values()) {
    if (c.tableId === null) send(c.ws, { t: 'tables', tables });
  }
}

// Pushes live matchmaking-queue sizes to everyone in the lobby.
function broadcastQueues(counts: Record<string, number> = matchmaker.counts()): void {
  for (const c of clients.values()) {
    if (c.tableId === null) send(c.ws, { t: 'queues', counts });
  }
}
matchmaker.onChange = (counts) => broadcastQueues(counts);

function bindTable(table: Table): void {
  table.onChange = () => {
    broadcastTable(table);
    maybeRecordMatch(table);
  };
}

// Leaving (or abandoning) a ranked game that's still in progress forfeits Elo.
const LEAVE_PENALTY = 50;
function forfeitIfRated(client: Client, table: Table | undefined): void {
  if (!table || !table.rated) return;
  if (table.status !== 'playing' && table.status !== 'between') return;
  // Only ranked games affect Elo — i.e. every seat must be a logged-in account.
  if (!table.seats.every((s) => !!s && s.id.startsWith('u_'))) return;
  const type = ratedType(table.format);
  if (type) void applyPenalty(client.id, type, LEAVE_PENALTY);
}

// Maps a match format to one of the five rated types, or null if non-standard.
function ratedType(format: MatchFormat): MatchType | null {
  const t = format.kind === 'deals' ? `deals-${format.deals}` : `race-${format.target}`;
  return (MATCH_TYPES as readonly string[]).includes(t) ? (t as MatchType) : null;
}

// Rates a match exactly once, when it finishes naturally with three logged-in
// accounts. Anonymous seats or aborted (someone-left) matches are not rated.
const ratedTables = new Set<string>();
function maybeRecordMatch(table: Table): void {
  if (table.status !== 'over' || !table.match?.finished || ratedTables.has(table.id)) return;
  ratedTables.add(table.id); // mark first so we never double-record
  if (!table.rated) return; // private games never count toward Elo
  const type = ratedType(table.format);
  if (!type) return;
  const seats = table.seats;
  if (seats.some((s) => !s || !s.id.startsWith('u_'))) return; // anonymous present — unrated
  const players = seats.map((s, slot) => ({ userId: s!.id, username: s!.nick, score: table.match!.scores[slot] }));
  void recordMatch(type, players).then(() => broadcastTable(table));
}

function joinTable(client: Client, table: Table): void {
  if (!table.addPlayer(client.id, client.nick)) {
    send(client.ws, { t: 'error', msg: 'cannot join (table full or already seated)' });
    return;
  }
  client.tableId = table.id;
  broadcastTable(table);
  broadcastLobby();
}

function leaveTable(client: Client): void {
  if (!client.tableId) return;
  const table = lobby.get(client.tableId);
  client.tableId = null;
  send(client.ws, { t: 'left' });
  send(client.ws, { t: 'queues', counts: matchmaker.counts() });
  if (table) {
    forfeitIfRated(client, table);
    table.removePlayer(client.id);
    broadcastTable(table);
    lobby.prune();
  }
  broadcastLobby();
}

// Points an incoming socket at an existing identity, cancelling any pending
// eviction, retiring a stale socket, and re-sending the player's current view.
function rebindTo(ws: WebSocket, target: Client): void {
  if (target.disconnectTimer) {
    clearTimeout(target.disconnectTimer);
    target.disconnectTimer = null;
  }
  const oldWs = target.ws;
  target.ws = ws;
  clients.set(ws, target);
  // If the identity still had a live socket (e.g. another tab), retire it
  // without dropping the player.
  if (oldWs !== ws) {
    clients.delete(oldWs);
    try {
      oldWs.close();
    } catch {
      /* already closing */
    }
  }

  send(ws, { t: 'welcome', playerId: target.id });
  if (target.tableId) {
    const table = lobby.get(target.tableId);
    if (table) send(ws, { t: 'table', view: table.view(target.id) });
    else target.tableId = null;
  }
  send(ws, { t: 'tables', tables: lobby.publicList() });
}

// Reattaches a reconnecting socket to a still-living anonymous identity (held
// open during the grace period after a drop). No-op if there's nothing to
// resume — the socket keeps its freshly-minted identity.
function resume(ws: WebSocket, playerId: string | null): void {
  const provisional = clients.get(ws);
  const prior = playerId ? byId.get(playerId) : undefined;
  if (!prior || prior === provisional) return;
  if (provisional) byId.delete(provisional.id); // drop the throwaway identity
  rebindTo(ws, prior);
}

// Binds a socket to a logged-in account identity. Reattaches to a held seat or
// another tab if the account is already connected; otherwise promotes this
// socket's throwaway identity to the account.
function authenticate(ws: WebSocket, token: string): void {
  const provisional = clients.get(ws);
  if (!provisional) return;
  const userId = userIdForToken(token);
  if (!userId) {
    send(ws, { t: 'error', msg: 'Session invalid or expired — please log in again.' });
    return;
  }
  const username = usernameForId(userId) ?? 'Player';
  if (provisional.id === userId) {
    provisional.nick = username;
    return;
  }
  const existing = byId.get(userId);
  byId.delete(provisional.id); // discard the throwaway identity
  if (existing && existing !== provisional) {
    existing.nick = username;
    rebindTo(ws, existing);
  } else {
    provisional.id = userId;
    provisional.nick = username;
    byId.set(userId, provisional);
    send(ws, { t: 'welcome', playerId: userId });
    send(ws, { t: 'tables', tables: lobby.publicList() });
  }
}

// Permanently evicts a player whose grace period expired without reconnecting.
function dropClient(client: Client): void {
  client.disconnectTimer = null;
  if (client.tableId) {
    const table = lobby.get(client.tableId);
    client.tableId = null;
    if (table) {
      forfeitIfRated(client, table);
      table.removePlayer(client.id);
      broadcastTable(table);
      lobby.prune();
    }
    broadcastLobby();
  }
  byId.delete(client.id);
}

// When the matchmaker forms a trio, seat them at a fresh unlisted table, which
// auto-starts as soon as the third player sits down.
matchmaker.onMatch = (format, ids) => {
  const cs = ids.map((id) => byId.get(id)).filter((c): c is Client => !!c);
  if (cs.length < 3) {
    // Someone vanished between queueing and matching — requeue the survivors.
    for (const c of cs) enqueueClient(c, format);
    return;
  }
  const table = lobby.create('private', format);
  table.rated = true; // matchmade games count toward Elo
  bindTable(table);
  for (const c of cs) {
    c.tableId = table.id;
    table.addPlayer(c.id, c.nick);
  }
  broadcastTable(table);
};

// Puts a player into the matchmaking queue for a format and tells them so.
function enqueueClient(client: Client, format: MatchFormat): void {
  if (client.tableId) leaveTable(client);
  const hasAccount = client.id.startsWith('u_');
  const type = ratedType(format);
  const rating = hasAccount && type ? ratingOf(client.id, type) : 1500;
  matchmaker.enqueue({ id: client.id, hasAccount, rating, joinedAt: Date.now() }, format);
  send(client.ws, { t: 'queued', format });
}

function handle(client: Client, msg: ClientMessage): void {
  switch (msg.t) {
    case 'hello':
      client.nick = msg.nick.trim().slice(0, 24) || client.nick;
      return;

    case 'listTables':
      send(client.ws, { t: 'tables', tables: lobby.publicList() });
      return;

    case 'createTable': {
      if (!client.id.startsWith('u_')) {
        send(client.ws, { t: 'error', msg: 'You need an account to create a private game.' });
        return;
      }
      if (client.tableId) leaveTable(client);
      const table = lobby.create(msg.visibility, msg.format);
      table.timed = msg.timed !== false; // private games may turn the clock off
      // table.rated stays false — private games never count toward Elo.
      bindTable(table);
      joinTable(client, table);
      return;
    }

    case 'joinTable': {
      const table = lobby.get(msg.tableId);
      if (!table) {
        send(client.ws, { t: 'error', msg: 'no such table' });
        return;
      }
      if (client.tableId && client.tableId !== table.id) leaveTable(client);
      joinTable(client, table);
      return;
    }

    case 'quickMatch':
      enqueueClient(client, msg.format ?? DEFAULT_FORMAT);
      return;

    case 'cancelMatch':
      matchmaker.dequeue(client.id);
      send(client.ws, { t: 'unqueued' });
      return;

    case 'leaveTable':
      matchmaker.dequeue(client.id);
      leaveTable(client);
      return;

    case 'chat': {
      if (!client.tableId) return;
      const table = lobby.get(client.tableId);
      if (table && table.addChat(client.id, msg.text)) broadcastTable(table);
      return;
    }

    case 'action': {
      if (!client.tableId) {
        send(client.ws, { t: 'error', msg: 'you are not at a table' });
        return;
      }
      const table = lobby.get(client.tableId);
      if (!table) return;
      const err = table.handleAction(client.id, msg.action);
      if (err) send(client.ws, { t: 'error', msg: err });
      broadcastTable(table);
      return;
    }
  }
}

// Simple sliding-window per-IP rate limiter, shared by the public endpoints.
function makeLimiter(max: number, windowMs: number): (ip: string) => boolean {
  const hits = new Map<string, number[]>();
  return (ip: string) => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

const feedbackAllowed = makeLimiter(5, 10 * 60 * 1000);
const authAllowed = makeLimiter(30, 10 * 60 * 1000);

function readBody(req: IncomingMessage, limit = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleFeedback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const json = (status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!feedbackAllowed(ip)) return json(429, { ok: false, error: 'too many submissions, try again later' });
  try {
    const parsed = JSON.parse(await readBody(req));
    // Honeypot: bots fill hidden fields. Pretend success and drop.
    if (parsed.website) return json(200, { ok: true });
    const message = String(parsed.message ?? '').trim();
    if (message.length < 2 || message.length > 4000) return json(400, { ok: false, error: 'message required (2–4000 chars)' });
    const contact = String(parsed.contact ?? '').trim().slice(0, 200) || undefined;
    await recordFeedback({ message: message.slice(0, 4000), contact, ip });
    json(200, { ok: true });
  } catch {
    json(400, { ok: false, error: 'invalid request' });
  }
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, action: 'register' | 'login' | 'logout'): Promise<void> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const json = (status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!authAllowed(ip)) return json(429, { ok: false, error: 'Too many attempts — try again later.' });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readBody(req, 2000));
  } catch {
    return json(400, { ok: false, error: 'Invalid request.' });
  }
  try {
    const username = String(parsed.username ?? '');
    const password = String(parsed.password ?? '');
    if (action === 'register') {
      const email = parsed.email ? String(parsed.email) : undefined;
      const r = await register(username, password, email);
      return json(r.ok ? 200 : 400, r);
    }
    if (action === 'login') {
      const r = await login(username, password);
      return json(r.ok ? 200 : 401, r);
    }
    await logout(String(parsed.token ?? ''));
    return json(200, { ok: true });
  } catch {
    return json(500, { ok: false, error: 'Server error.' });
  }
}

async function handleProfile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const json = (status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  let token = '';
  try {
    token = String(JSON.parse(await readBody(req, 2000)).token ?? '');
  } catch {
    return json(400, { ok: false, error: 'Invalid request.' });
  }
  const userId = userIdForToken(token);
  if (!userId) return json(401, { ok: false, error: 'Not logged in.' });
  json(200, { ok: true, username: usernameForId(userId), ratings: ratingsFor(userId), history: historyFor(userId) });
}

// Serve the built client (same origin as the API/WS, so /ws, /auth, /feedback
// all resolve). Override the location with LISKAT_CLIENT_DIR if needed.
const CLIENT_DIR = process.env.LISKAT_CLIENT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // Resolve within CLIENT_DIR; strip any leading traversal so we can't escape it.
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(CLIENT_DIR, rel);
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + (process.platform === 'win32' ? '\\' : '/'))) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    if (filePath === CLIENT_DIR || (await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // Single-page app: unknown paths fall back to index.html.
    try {
      const body = await readFile(join(CLIENT_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }
}

function fmtFormat(f: MatchFormat): string {
  return f.kind === 'deals' ? `${f.deals} deals` : `race ${f.target}`;
}

// Live snapshot for the monitoring dashboard.
function gatherStats(): object {
  const tables = lobby.snapshot();
  const active = tables.filter((t) => t.status === 'playing' || t.status === 'between');
  const waiting = tables.filter((t) => t.status === 'waiting');
  const onlineAccounts = new Set([...clients.values()].filter((c) => c.id.startsWith('u_')).map((c) => c.id));
  const queueByFormat = matchmaker.counts();
  const queued = Object.values(queueByFormat).reduce((a, b) => a + b, 0);
  return {
    now: new Date().toISOString(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    connected: clients.size,
    onlineAccounts: onlineAccounts.size,
    activeGames: active.length,
    waitingTables: waiting.length,
    queued,
    queueByFormat,
    registeredAccounts: accountCount(),
    ratedPlayers: ratedPlayerCount(),
    matchesPlayed: matchCount(),
    games: active.map((t) => ({ id: t.id, status: t.status, seated: t.seated, format: fmtFormat(t.format), rated: t.rated })),
  };
}

function handleStats(req: IncomingMessage, res: ServerResponse): void {
  const json = (status: number, body: object) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!ADMIN_TOKEN) return json(503, { error: 'monitoring disabled — set ADMIN_TOKEN' });
  const key = (req.headers['x-admin-key'] as string) || new URL(req.url ?? '/', 'http://x').searchParams.get('key') || '';
  if (key !== ADMIN_TOKEN) return json(401, { error: 'unauthorized' });
  json(200, gatherStats());
}

// Self-contained monitoring dashboard served at /admin. Prompts for the admin
// key, stores it locally, then polls /stats every 5s. No backticks / ${} inside
// so it stays a plain template literal.
const ADMIN_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>liskat monitor</title>',
  '<style>',
  ':root{color-scheme:dark}body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#f2f5f3;background:radial-gradient(ellipse at 50% 30%,#0f5132,#0a3d26 75%);min-height:100vh;padding:28px}',
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:#b9c7c0;text-transform:uppercase;letter-spacing:1px}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}',
  '.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px}',
  '.card .label{font-size:12px;color:#b9c7c0}.card .value{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums}',
  'table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08)}th{color:#b9c7c0}',
  'input{padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#f2f5f3;font-size:15px}',
  'button{padding:9px 13px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#f2f5f3;cursor:pointer;font-size:15px}',
  '.muted{color:#b9c7c0;font-size:12px;margin-top:14px}#err{color:#ff8a80}',
  '</style></head><body>',
  '<h1>liskat monitor</h1><p class="muted" id="sub">live server stats</p>',
  '<div id="login" style="display:none;margin-top:16px"><p>Admin key</p><input id="key" type="password" autocomplete="off"> <button onclick="saveKey()">View</button><p id="err"></p></div>',
  '<div id="dash" style="display:none"><div class="grid" id="cards"></div><h2>Active games</h2>',
  '<table><thead><tr><th>ID</th><th>Format</th><th>Seated</th><th>Status</th><th>Ranked</th></tr></thead><tbody id="games"></tbody></table>',
  '<p class="muted" id="foot"></p><p class="muted"><button onclick="logout()">Forget key</button></p></div>',
  '<script>',
  'var key=localStorage.getItem("liskat.adminkey")||"";',
  'function show(id,on){document.getElementById(id).style.display=on?"":"none"}',
  'function saveKey(){key=document.getElementById("key").value.trim();localStorage.setItem("liskat.adminkey",key);load()}',
  'function logout(){localStorage.removeItem("liskat.adminkey");key="";load()}',
  'function card(l,v){return "<div class=\\"card\\"><div class=\\"label\\">"+l+"</div><div class=\\"value\\">"+v+"</div></div>"}',
  'function up(s){var h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h+"h "+m+"m"}',
  'async function load(){',
  ' if(!key){show("login",true);show("dash",false);return}',
  ' try{var r=await fetch("/stats",{headers:{"x-admin-key":key}});',
  '  if(r.status===401){show("login",true);show("dash",false);document.getElementById("err").textContent="Wrong key.";return}',
  '  if(!r.ok){show("login",true);show("dash",false);document.getElementById("err").textContent="Unavailable (status "+r.status+").";return}',
  '  var s=await r.json();show("login",false);show("dash",true);',
  '  document.getElementById("cards").innerHTML=card("Connected",s.connected)+card("Accounts online",s.onlineAccounts)+card("Active games",s.activeGames)+card("In queue",s.queued)+card("Waiting tables",s.waitingTables)+card("Registered accounts",s.registeredAccounts)+card("Matches played",s.matchesPlayed)+card("Uptime",up(s.uptimeSec));',
  '  document.getElementById("games").innerHTML=s.games.length?s.games.map(function(g){return "<tr><td>"+g.id+"</td><td>"+g.format+"</td><td>"+g.seated+"/3</td><td>"+g.status+"</td><td>"+(g.rated?"yes":"no")+"</td></tr>"}).join(""):"<tr><td colspan=5 class=muted>No active games.</td></tr>";',
  '  document.getElementById("foot").textContent="Updated "+new Date(s.now).toLocaleTimeString()+" · refreshes every 5s";',
  ' }catch(e){var f=document.getElementById("foot");if(f)f.textContent="Network error."}',
  '}',
  'load();setInterval(load,5000);',
  '</script></body></html>',
].join('');

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'POST' && req.url === '/feedback') {
    void handleFeedback(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/auth/register') return void handleAuth(req, res, 'register');
  if (req.method === 'POST' && req.url === '/auth/login') return void handleAuth(req, res, 'login');
  if (req.method === 'POST' && req.url === '/auth/logout') return void handleAuth(req, res, 'logout');
  if (req.method === 'POST' && req.url === '/auth/profile') return void handleProfile(req, res);
  if (req.method === 'GET' && (req.url ?? '').startsWith('/stats')) return void handleStats(req, res);
  if (req.method === 'GET' && (req.url === '/admin' || (req.url ?? '').startsWith('/admin?'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ADMIN_HTML);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return void serveStatic(req, res);
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

// Heartbeat: ping every connection periodically so proxies (Fly's, in
// particular) don't cull idle WebSockets, and so we can detect and drop sockets
// that have silently died. Browsers answer pings with pongs automatically.
const HEARTBEAT_MS = 25_000;
type Keepalive = { isAlive?: boolean };
const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    const w = ws as unknown as Keepalive;
    if (w.isAlive === false) {
      ws.terminate(); // missed the previous ping — it's gone
      continue;
    }
    w.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* socket closing */
    }
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeatTimer));

wss.on('connection', (ws) => {
  (ws as unknown as Keepalive).isAlive = true;
  ws.on('pong', () => ((ws as unknown as Keepalive).isAlive = true));
  // Every socket starts with a throwaway identity; a `resume` message can swap
  // it for an existing one whose seat is being held open.
  const client: Client = { id: newId(), nick: `Guest-${counter}`, tableId: null, ws, disconnectTimer: null };
  clients.set(ws, client);
  byId.set(client.id, client);
  send(ws, { t: 'welcome', playerId: client.id });
  send(ws, { t: 'tables', tables: lobby.publicList() });
  send(ws, { t: 'queues', counts: matchmaker.counts() });

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send(ws, { t: 'error', msg: 'invalid JSON' });
      return;
    }
    if (msg.t === 'resume') {
      resume(ws, msg.playerId);
      return;
    }
    if (msg.t === 'auth') {
      authenticate(ws, msg.token);
      return;
    }
    // Resolve the live identity for this socket (may have changed via resume).
    const c = clients.get(ws);
    if (!c) return;
    try {
      handle(c, msg);
    } catch (e) {
      send(ws, { t: 'error', msg: (e as Error).message });
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    clients.delete(ws);
    if (!c || c.ws !== ws) return; // this socket was already superseded by a resume
    matchmaker.dequeue(c.id); // drop out of any matchmaking queue
    if (c.tableId) {
      // Hold the seat briefly so a reload can reconnect; evict if it doesn't.
      c.disconnectTimer = setTimeout(() => dropClient(c), RECONNECT_GRACE_MS);
    } else {
      byId.delete(c.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Liskat server listening on :${PORT} (ws + /health)`);
});
