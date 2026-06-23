// The lobby owns every table. Tables are created either as private rooms (to
// share a link) or by the matchmaker when it forms a trio.

import type { MatchFormat } from '@liskat/engine';
import { Table } from './table.ts';
import type { LobbyEntry } from './protocol.ts';

function makeId(): string {
  // Short, link-friendly, lowercase, e.g. "k7m2qp".
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

export class Lobby {
  private tables = new Map<string, Table>();

  create(visibility: 'private' | 'public', format: MatchFormat): Table {
    let id = makeId();
    while (this.tables.has(id)) id = makeId();
    const table = new Table(id, visibility, format);
    this.tables.set(id, table);
    return table;
  }

  get(id: string): Table | undefined {
    return this.tables.get(id);
  }

  remove(id: string): void {
    this.tables.delete(id);
  }

  // Discards empty tables so abandoned rooms don't pile up. Returns the ids of
  // the tables that were removed, so callers can drop any per-table bookkeeping.
  prune(): string[] {
    const removed: string[] = [];
    for (const [id, t] of this.tables) {
      if (t.isEmpty()) {
        this.tables.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  publicList(): LobbyEntry[] {
    const out: LobbyEntry[] = [];
    for (const t of this.tables.values()) {
      if (t.visibility === 'public' && t.status === 'waiting') {
        out.push({ id: t.id, hostNick: t.hostNick(), seated: t.seatedCount, format: t.format });
      }
    }
    return out;
  }

  // Lightweight summary of every table, for the monitoring dashboard.
  snapshot(): { id: string; status: string; visibility: string; seated: number; format: MatchFormat; rated: boolean }[] {
    return [...this.tables.values()].map((t) => ({
      id: t.id,
      status: t.status,
      visibility: t.visibility,
      seated: t.seatedCount,
      format: t.format,
      rated: t.rated,
    }));
  }
}
