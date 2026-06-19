// Liskat game server. One WebSocket connection == one player. The server is
// authoritative: it owns the deck, validates every action through the engine,
// and sends each player a redacted view (you only see your own hand).

import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Lobby } from './lobby.ts';
import type { Table } from './table.ts';
import type { ClientMessage, ServerMessage } from './protocol.ts';
import { recordFeedback } from './feedback.ts';

const PORT = Number(process.env.PORT ?? 8080);
const lobby = new Lobby();

interface Client {
  id: string;
  nick: string;
  tableId: string | null;
  ws: WebSocket;
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

function bindTable(table: Table): void {
  table.onChange = () => broadcastTable(table);
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
  if (table) {
    table.removePlayer(client.id);
    broadcastTable(table);
    lobby.prune();
  }
  broadcastLobby();
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
      if (client.tableId) leaveTable(client);
      const table = lobby.create(msg.visibility, msg.format);
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

    case 'quickMatch': {
      if (client.tableId) leaveTable(client);
      const table = lobby.quickMatch(msg.format);
      bindTable(table);
      joinTable(client, table);
      return;
    }

    case 'leaveTable':
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

// Simple per-IP rate limiter for the public feedback endpoint.
const feedbackHits = new Map<string, number[]>();
function feedbackAllowed(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (feedbackHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= 5) {
    feedbackHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  feedbackHits.set(ip, recent);
  return true;
}

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
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const client: Client = { id: newId(), nick: `Guest-${counter}`, tableId: null, ws };
  clients.set(ws, client);
  byId.set(client.id, client);
  send(ws, { t: 'welcome', playerId: client.id });
  send(ws, { t: 'tables', tables: lobby.publicList() });

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send(ws, { t: 'error', msg: 'invalid JSON' });
      return;
    }
    try {
      handle(client, msg);
    } catch (e) {
      send(ws, { t: 'error', msg: (e as Error).message });
    }
  });

  ws.on('close', () => {
    leaveTable(client);
    clients.delete(ws);
    byId.delete(client.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Liskat server listening on :${PORT} (ws + /health)`);
});
