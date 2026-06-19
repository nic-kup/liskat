// Liskat game server. One WebSocket connection == one player. The server is
// authoritative: it owns the deck, validates every action through the engine,
// and sends each player a redacted view (you only see your own hand).

import { WebSocketServer, type WebSocket } from 'ws';
import { createServer } from 'node:http';
import { Lobby } from './lobby.ts';
import type { Table } from './table.ts';
import type { ClientMessage, ServerMessage } from './protocol.ts';

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

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
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
