// Quick-match matchmaking. Players who pick a quick-match format go into a
// per-format queue (not a visible table). A short "prefer" window lets the
// engine hold out for a high-quality trio (same account status and similar
// Elo), then it relaxes to greedy so nobody waits forever. Even when greedy,
// it still picks the *closest* available trio, so preferences are honoured up
// to the point of not blocking a match.

import type { MatchFormat } from '@liskat/engine';

export interface Searcher {
  id: string;
  hasAccount: boolean;
  rating: number;
  joinedAt: number;
}

const TICK_MS = 500;
const PREFER_WINDOW_MS = 3000; // hold out for a good match this long, then go greedy
const ACCOUNT_PENALTY = 5000; // cost of pairing different account statuses (dwarfs any Elo gap)
const STRICT_TRIO_COST = 450; // max total pairwise cost to accept during the prefer window (~150 Elo avg)

export function formatKey(f: MatchFormat): string {
  return f.kind === 'deals' ? `deals-${f.deals}` : `race-${f.target}`;
}

const pairCost = (a: Searcher, b: Searcher): number => Math.abs(a.rating - b.rating) + (a.hasAccount === b.hasAccount ? 0 : ACCOUNT_PENALTY);
const trioCost = (a: Searcher, b: Searcher, c: Searcher): number => pairCost(a, b) + pairCost(a, c) + pairCost(b, c);

export class Matchmaker {
  private queues = new Map<string, Searcher[]>(); // formatKey -> searchers (oldest first)
  private formats = new Map<string, MatchFormat>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private lastSig = '';

  // Called when a trio is formed. The wiring layer turns it into a table.
  onMatch: (format: MatchFormat, ids: string[]) => void = () => {};
  // Called when the queue sizes change, so the lobby can show live counts.
  onChange: (counts: Record<string, number>) => void = () => {};

  // Number of players waiting per format key (drained formats are absent → 0).
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, q] of this.queues) out[key] = q.length;
    return out;
  }

  // Broadcasts queue counts, but only when they actually changed.
  private notify(): void {
    const counts = this.counts();
    const sig = JSON.stringify(counts);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.onChange(counts);
    }
  }

  enqueue(searcher: Searcher, format: MatchFormat): void {
    this.dequeue(searcher.id);
    const key = formatKey(format);
    this.formats.set(key, format);
    const q = this.queues.get(key) ?? [];
    q.push(searcher);
    this.queues.set(key, q);
    this.ensureTimer();
    this.process();
    this.notify();
  }

  dequeue(id: string): boolean {
    let removed = false;
    for (const [key, q] of this.queues) {
      const i = q.findIndex((s) => s.id === id);
      if (i >= 0) {
        q.splice(i, 1);
        removed = true;
        if (q.length === 0) this.queues.delete(key);
      }
    }
    if (removed) this.notify();
    return removed;
  }

  isQueued(id: string): boolean {
    for (const q of this.queues.values()) if (q.some((s) => s.id === id)) return true;
    return false;
  }

  // The best trio to form from a queue right now, or null to keep waiting. The
  // oldest searcher seeds the trio (so the longest waiter is served first); the
  // other two are chosen to minimise total Elo/account distance.
  private bestTrio(q: Searcher[]): Searcher[] | null {
    if (q.length < 3) return null;
    const seed = q[0];
    const rest = q.slice(1);
    let best: Searcher[] | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const cost = trioCost(seed, rest[i], rest[j]);
        if (cost < bestCost) {
          bestCost = cost;
          best = [seed, rest[i], rest[j]];
        }
      }
    }
    if (!best) return null;
    // During the prefer window only accept a tight, same-account-status trio.
    const picky = Date.now() - seed.joinedAt < PREFER_WINDOW_MS;
    if (picky && !(bestCost < ACCOUNT_PENALTY && bestCost <= STRICT_TRIO_COST)) return null;
    return best;
  }

  private process(): void {
    if (this.processing) return; // guard against re-entry via onMatch
    this.processing = true;
    try {
      for (const [key, q] of this.queues) {
        const format = this.formats.get(key)!;
        let trio = this.bestTrio(q);
        while (trio) {
          for (const s of trio) q.splice(q.indexOf(s), 1);
          this.onMatch(format, trio.map((s) => s.id));
          trio = this.bestTrio(q);
        }
        if (q.length === 0) this.queues.delete(key);
      }
    } finally {
      this.processing = false;
    }
    if (this.queues.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.notify();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.process(), TICK_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }
}
