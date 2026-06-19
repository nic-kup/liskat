// A Table seats three players and runs a Skat match through the engine: it
// deals rounds, validates and applies actions, advances between deals, and
// produces a redacted view per player (you only ever see your own hand).

import {
  createMatch,
  recordRound,
  createRound,
  applyAction,
  legalCards,
  deal,
  type MatchFormat,
  type MatchState,
  type RoundState,
  type Action,
  isChatPreset,
  type Seat,
  type Card,
} from '@liskat/engine';
import type { ClientAction } from './protocol.ts';

const BETWEEN_DEALS_MS = 6000;

export type TableStatus = 'waiting' | 'playing' | 'between' | 'over';

interface Seated {
  id: string;
  nick: string;
}

// role of slot s on deal d, and the slot that holds role r on deal d.
// Forehand (role 0) rotates one seat each deal.
const roleOfSlot = (slot: number, dealIndex: number): Seat => (((slot - dealIndex) % 3) + 3) % 3 as Seat;
const slotOfRole = (role: Seat, dealIndex: number): number => (dealIndex + role) % 3;

export class Table {
  readonly id: string;
  readonly visibility: 'private' | 'public';
  readonly format: MatchFormat;
  seats: (Seated | null)[] = [null, null, null];
  status: TableStatus = 'waiting';
  match: MatchState | null = null;
  round: RoundState | null = null;
  dealIndex = 0;
  chat: { nick: string; text: string }[] = [];

  // Injected so the server can re-send views whenever something changes.
  onChange: () => void = () => {};
  // Injected timer so tests can run without real delays; defaults to setTimeout.
  private schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  };

  constructor(id: string, visibility: 'private' | 'public', format: MatchFormat) {
    this.id = id;
    this.visibility = visibility;
    this.format = format;
  }

  get seatedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  hostNick(): string {
    return this.seats.find(Boolean)?.nick ?? '—';
  }

  hasPlayer(id: string): boolean {
    return this.seats.some((s) => s?.id === id);
  }

  slotOf(id: string): number {
    return this.seats.findIndex((s) => s?.id === id);
  }

  // Seats a player in the first open slot. Returns false if full or already in.
  addPlayer(id: string, nick: string): boolean {
    if (this.hasPlayer(id)) return false;
    const slot = this.seats.findIndex((s) => s === null);
    if (slot < 0) return false;
    this.seats[slot] = { id, nick };
    if (this.seatedCount === 3 && this.status === 'waiting') this.startMatch();
    return true;
  }

  removePlayer(id: string): void {
    const slot = this.slotOf(id);
    if (slot < 0) return;
    this.seats[slot] = null;
    // If a game was in progress, it cannot continue with an empty seat.
    if (this.status === 'playing' || this.status === 'between') {
      this.status = this.match ? 'over' : 'waiting';
    }
  }

  isEmpty(): boolean {
    return this.seatedCount === 0;
  }

  private startMatch(): void {
    this.match = createMatch(this.format);
    this.dealIndex = 0;
    this.startDeal();
  }

  private startDeal(): void {
    this.round = createRound(deal(() => Math.random()));
    this.status = 'playing';
  }

  // Applies a player's action to the current round, then advances if the round
  // ended. Returns an error message if the action was illegal.
  handleAction(id: string, ca: ClientAction): string | null {
    if (this.status !== 'playing' || !this.round) return 'no active round';
    const slot = this.slotOf(id);
    if (slot < 0) return 'you are not seated at this table';
    const role = roleOfSlot(slot, this.dealIndex);

    const action = { ...ca, seat: role } as Action;
    let next: RoundState;
    try {
      next = applyAction(this.round, action);
    } catch (e) {
      return (e as Error).message;
    }
    this.round = next;

    if (next.phase === 'finished') this.endRound();
    return null;
  }

  private endRound(): void {
    const r = this.round!;
    recordRoundIntoMatch(this, r);
    this.status = 'between';
    this.schedule(() => {
      this.dealIndex += 1;
      if (this.match!.finished) {
        this.status = 'over';
      } else {
        this.startDeal();
      }
      this.onChange();
    }, BETWEEN_DEALS_MS);
  }

  /** Test seam: replace the inter-deal scheduler. */
  setScheduler(fn: (cb: () => void, ms: number) => void): void {
    this.schedule = fn;
  }

  // Adds a canned chat phrase from a seated player. Free text is rejected.
  addChat(id: string, text: string): boolean {
    const seat = this.seats.find((s) => s?.id === id);
    if (!seat || !isChatPreset(text)) return false;
    this.chat.push({ nick: seat.nick, text });
    if (this.chat.length > 30) this.chat.shift();
    return true;
  }

  view(viewerId: string): TableView {
    const youSlot = this.slotOf(viewerId);
    const players = this.seats.map((s, slot) => ({
      slot,
      role: roleOfSlot(slot as Seat, this.dealIndex),
      nick: s?.nick ?? null,
      occupied: s !== null,
      you: s?.id === viewerId,
    }));

    let round: RoundView | undefined;
    if (this.round && (this.status === 'playing' || this.status === 'between')) {
      const r = this.round;
      const myRole = youSlot >= 0 ? roleOfSlot(youSlot as Seat, this.dealIndex) : null;
      const finished = r.phase === 'finished';
      round = {
        phase: r.phase,
        bidding:
          r.phase === 'bidding'
            ? {
                awaiting: r.bidding.awaiting,
                askerSlot: slotOfRole(r.bidding.asker, this.dealIndex),
                responderSlot: r.bidding.responder === null ? null : slotOfRole(r.bidding.responder, this.dealIndex),
                currentBid: r.bidding.currentBid,
              }
            : undefined,
        declarerSlot: r.declarer === null ? null : slotOfRole(r.declarer, this.dealIndex),
        bid: r.bid,
        tookSkat: r.tookSkat,
        declareStep: r.declareStep,
        contract: r.contract,
        announcements: r.announcements,
        turnSlot: slotOfRole(r.turn, this.dealIndex),
        leaderSlot: slotOfRole(r.leader, this.dealIndex),
        trick: r.trick.map((t) => ({ slot: slotOfRole(t.seat, this.dealIndex), card: t.card })),
        trickCount: r.trickCount,
        handCounts: [r.hands[0].length, r.hands[1].length, r.hands[2].length],
        yourHand: myRole !== null ? r.hands[myRole].slice() : [],
        legal: myRole !== null && r.phase === 'playing' && r.turn === myRole ? legalCards(r, myRole) : [],
        passedIn: r.passedIn,
        result: finished ? r.result : null,
        skat: finished ? r.skat : null,
      };
    }

    return {
      id: this.id,
      visibility: this.visibility,
      format: this.format,
      status: this.status,
      dealIndex: this.dealIndex,
      youSlot: youSlot >= 0 ? youSlot : null,
      players,
      match: this.match ? { scores: this.match.scores, dealsPlayed: this.match.dealsPlayed, finished: this.match.finished, winner: this.match.winner } : null,
      round,
      chat: this.chat.slice(),
    };
  }
}

function recordRoundIntoMatch(table: Table, r: RoundState): void {
  table.match = recordRound(table.match!, table.dealIndex, r.passedIn ? null : r.declarer, r.passedIn ? null : r.result);
}

// ---- View shapes -----------------------------------------------------------

export interface TableView {
  id: string;
  visibility: 'private' | 'public';
  format: MatchFormat;
  status: TableStatus;
  dealIndex: number;
  youSlot: number | null;
  players: { slot: number; role: Seat; nick: string | null; occupied: boolean; you: boolean }[];
  match: { scores: number[]; dealsPlayed: number; finished: boolean; winner: number | null } | null;
  round?: RoundView;
  chat: { nick: string; text: string }[];
}

export interface RoundView {
  phase: RoundState['phase'];
  bidding?: { awaiting: string; askerSlot: number; responderSlot: number | null; currentBid: number };
  declarerSlot: number | null;
  bid: number;
  tookSkat: boolean;
  declareStep: RoundState['declareStep'];
  contract: RoundState['contract'];
  announcements: RoundState['announcements'];
  turnSlot: number;
  leaderSlot: number;
  trick: { slot: number; card: Card }[];
  trickCount: number;
  handCounts: number[];
  yourHand: Card[];
  legal: Card[];
  passedIn: boolean;
  result: RoundState['result'];
  skat: [Card, Card] | null;
}
