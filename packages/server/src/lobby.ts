// The lobby owns every table and handles matchmaking: create a private table
// to share a link, or quick-match into the next open public table.

import type { MatchFormat } from '@liskat/engine';
import { Table } from './table.ts';
import type { LobbyEntry } from './protocol.ts';

const DEFAULT_FORMAT: MatchFormat = { kind: 'deals', deals: 12 };

function makeId(): string {
  // Short, link-friendly, lowercase — e.g. "k7m2qp".
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

  // Finds an open public table (waiting, with a free seat) or creates one.
  quickMatch(format: MatchFormat = DEFAULT_FORMAT): Table {
    for (const t of this.tables.values()) {
      if (t.visibility === 'public' && t.status === 'waiting' && t.seatedCount < 3 && sameFormat(t.format, format)) {
        return t;
      }
    }
    return this.create('public', format);
  }

  remove(id: string): void {
    this.tables.delete(id);
  }

  // Discards empty tables so abandoned rooms don't pile up.
  prune(): void {
    for (const [id, t] of this.tables) {
      if (t.isEmpty()) this.tables.delete(id);
    }
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

function sameFormat(a: MatchFormat, b: MatchFormat): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'deals' ? a.deals === (b as typeof a).deals : a.target === (b as typeof a).target;
}
