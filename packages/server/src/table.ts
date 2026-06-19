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
const TRICK_REVEAL_MS = 500; // how long a completed trick stays on the table before it is swept

// Move clock: every player gets TURN_BASE_MS for each decision, drawing on a
// personal time bank once that runs out. The bank starts at BANK_START_MS and
// grows by BANK_PER_DEAL_MS at the start of each new deal. Run the clock to
// zero and a random legal move is played for you.
const TURN_BASE_MS = 10_000;
const FIRST_BID_MS = 20_000; // the opening bid gets extra time to size up the hand
const BANK_START_MS = 30_000;
const BANK_PER_DEAL_MS = 10_000;

export interface HistoryEntry {
  deal: number;
  declarerSlot: number | null;
  short: string | null; // ♦ ♥ ♠ ♣ G N, or null for a passed deal
  won: boolean | null;
  value: number;
  passedIn: boolean;
  scores: number[]; // running totals after this deal
}

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
  chat: { nick: string; slot: number; text: string }[] = [];
  history: HistoryEntry[] = [];

  // Whether this match counts toward Elo (only matchmade games) and whether the
  // move clock runs (off can be chosen for private games).
  rated = false;
  timed = true;

  // Move clock, per slot. timeBank is remaining reserve (ms); turnTimer fires
  // when the active player runs out; timedSlot/turnStart track the clock that
  // is currently running so overtime can be charged to the right player.
  private timeBank: number[] = [BANK_START_MS, BANK_START_MS, BANK_START_MS];
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnStart = 0;
  private timedSlot = -1;
  private turnAllowance = TURN_BASE_MS; // base time for the clock currently running

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
      this.clearTurnTimer();
    }
  }

  isEmpty(): boolean {
    return this.seatedCount === 0;
  }

  private startMatch(): void {
    this.match = createMatch(this.format);
    this.dealIndex = 0;
    this.timeBank = [BANK_START_MS, BANK_START_MS, BANK_START_MS];
    this.startDeal();
  }

  private startDeal(): void {
    this.round = createRound(deal(() => Math.random()));
    this.status = 'playing';
    // Top up everyone's time bank for the new deal (deal 1 keeps the start value).
    if (this.dealIndex > 0) this.timeBank = this.timeBank.map((b) => b + BANK_PER_DEAL_MS);
    this.armTimer();
  }

  // Applies a player's action to the current round, then advances if the round
  // ended. Returns an error message if the action was illegal.
  handleAction(id: string, ca: ClientAction): string | null {
    if (this.status !== 'playing' || !this.round) return 'no active round';
    const slot = this.slotOf(id);
    if (slot < 0) return 'you are not seated at this table';
    const role = roleOfSlot(slot, this.dealIndex);

    const action = { ...ca, seat: role } as Action;
    try {
      this.round = applyAction(this.round, action);
    } catch (e) {
      return (e as Error).message;
    }
    this.charge();
    this.advance();
    this.armTimer();
    return null;
  }

  // ---- Move clock ----------------------------------------------------------

  // The slot that must act right now, or -1 when no one is on the clock
  // (between deals, during the brief trick reveal, or a finished round).
  private activeSlot(): number {
    const r = this.round;
    if (!r || this.status !== 'playing') return -1;
    if (r.phase === 'bidding') {
      const role = r.bidding.awaiting === 'response' ? r.bidding.responder : r.bidding.asker;
      return role === null ? -1 : slotOfRole(role, this.dealIndex);
    }
    if (r.phase === 'declaring') return r.declarer === null ? -1 : slotOfRole(r.declarer, this.dealIndex);
    if (r.phase === 'playing') return r.trickComplete ? -1 : slotOfRole(r.turn, this.dealIndex);
    return -1;
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  // Base time for the current decision: the opening bid of a deal gets extra.
  private baseAllowance(): number {
    const r = this.round;
    if (r && r.phase === 'bidding' && r.bidding.lastActions.every((a) => a === null)) return FIRST_BID_MS;
    return TURN_BASE_MS;
  }

  // Starts the clock for whoever is on turn now.
  private armTimer(): void {
    this.clearTurnTimer();
    if (!this.timed) {
      this.timedSlot = -1;
      this.turnStart = 0;
      return;
    }
    const slot = this.activeSlot();
    this.timedSlot = slot;
    if (slot < 0) {
      this.turnStart = 0;
      return;
    }
    this.turnAllowance = this.baseAllowance();
    const ms = this.turnAllowance + Math.max(0, this.timeBank[slot]);
    this.turnStart = Date.now();
    this.turnTimer = setTimeout(() => this.onTimeout(slot), ms);
    // Don't let a pending clock keep the process (or a test runner) alive.
    (this.turnTimer as { unref?: () => void }).unref?.();
  }

  // Time left on the active player's clock right now (base + bank), or null.
  private turnRemainingMs(): number | null {
    const slot = this.activeSlot();
    if (slot < 0 || this.turnStart === 0) return null;
    const allowance = this.turnAllowance + Math.max(0, this.timeBank[slot]);
    return Math.max(0, allowance - (Date.now() - this.turnStart));
  }

  // Charges any time spent beyond the base allowance to the active player's bank.
  private charge(): void {
    if (this.timedSlot < 0 || this.turnStart === 0) return;
    const over = Date.now() - this.turnStart - this.turnAllowance;
    if (over > 0) this.timeBank[this.timedSlot] = Math.max(0, this.timeBank[this.timedSlot] - over);
    this.turnStart = 0;
  }

  // Fired when a player's clock hits zero: drain their bank and play a random
  // legal move on their behalf, then carry on.
  private onTimeout(slot: number): void {
    this.turnTimer = null;
    if (this.status !== 'playing' || !this.round) return;
    if (this.activeSlot() !== slot) return; // state already moved on
    this.timeBank[slot] = 0;
    const action = this.randomAction(slot);
    if (action) {
      try {
        this.round = applyAction(this.round, action);
      } catch {
        return;
      }
    }
    this.turnStart = 0;
    this.advance();
    this.armTimer();
    this.onChange();
  }

  // A legal move to play when a player runs out of time.
  private randomAction(slot: number): Action | null {
    const r = this.round!;
    const role = roleOfSlot(slot, this.dealIndex);
    if (r.phase === 'bidding') {
      // A timeout in the auction is a pass — the safe move that never commits a
      // player to a contract they didn't choose.
      return { type: 'pass', seat: role };
    }
    if (r.phase === 'declaring') {
      if (r.declareStep === 'choose') return { type: 'playHand', seat: role };
      if (r.declareStep === 'discard') {
        const hand = r.hands[role];
        return { type: 'discard', seat: role, cards: [hand[0], hand[1]] };
      }
      if (r.declareStep === 'contract') return { type: 'declareContract', seat: role, contract: { type: 'suit', suit: 'C' } };
      return null;
    }
    if (r.phase === 'playing') {
      const legal = legalCards(r, role);
      if (legal.length === 0) return null;
      return { type: 'playCard', seat: role, card: legal[Math.floor(Math.random() * legal.length)] };
    }
    return null;
  }

  // Drives automatic transitions: a completed trick is revealed briefly then
  // collected; a finished round is recorded and the next deal scheduled.
  private advance(): void {
    const r = this.round!;
    if (r.phase === 'playing' && r.trickComplete) {
      this.schedule(() => {
        this.round = applyAction(this.round!, { type: 'collect' });
        if (this.round.phase === 'finished') this.endRound();
        this.armTimer();
        this.onChange();
      }, TRICK_REVEAL_MS);
    } else if (r.phase === 'finished') {
      this.endRound();
    }
  }

  private endRound(): void {
    const r = this.round!;
    recordRoundIntoMatch(this, r);
    this.history.push({
      deal: this.dealIndex + 1,
      declarerSlot: r.passedIn || r.declarer === null ? null : slotOfRole(r.declarer, this.dealIndex),
      short: r.passedIn ? null : shortContract(r.contract),
      won: r.passedIn ? null : (r.result?.won ?? null),
      value: r.result?.value ?? 0,
      passedIn: r.passedIn,
      scores: [...this.match!.scores],
    });
    this.status = 'between';
    this.clearTurnTimer();
    this.schedule(() => {
      this.dealIndex += 1;
      if (this.match!.finished) {
        this.status = 'over';
        this.clearTurnTimer();
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
    const slot = this.seats.findIndex((s) => s?.id === id);
    const seat = slot >= 0 ? this.seats[slot] : null;
    if (!seat || !isChatPreset(text)) return false;
    this.chat.push({ nick: seat.nick, slot, text });
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
                lastBidderSlot: r.bidding.lastBidderSeat === null ? null : slotOfRole(r.bidding.lastBidderSeat, this.dealIndex),
                lastActions: r.bidding.lastActions,
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
        trickComplete: r.trickComplete,
        lastTrick: r.lastTrick.map((t) => ({ slot: slotOfRole(t.seat, this.dealIndex), card: t.card })),
        lastTrickWinnerSlot: r.lastTrickWinner === null ? null : slotOfRole(r.lastTrickWinner, this.dealIndex),
        trickCount: r.trickCount,
        handCounts: [r.hands[0].length, r.hands[1].length, r.hands[2].length],
        yourHand: myRole !== null ? r.hands[myRole].slice() : [],
        legal: myRole !== null && r.phase === 'playing' && r.turn === myRole ? legalCards(r, myRole) : [],
        passedIn: r.passedIn,
        result: finished ? r.result : null,
        skat: finished ? r.skat : null,
        banks: this.timeBank.slice(),
        turnRemainingMs: this.turnRemainingMs(),
      };
    }

    return {
      id: this.id,
      visibility: this.visibility,
      format: this.format,
      status: this.status,
      timed: this.timed,
      rated: this.rated,
      // Actually counts toward Elo only when it's a rated game AND every seat is
      // a logged-in account (account ids are prefixed "u_").
      ranked: this.rated && this.seats.every((s) => !!s && s.id.startsWith('u_')),
      dealIndex: this.dealIndex,
      youSlot: youSlot >= 0 ? youSlot : null,
      players,
      match: this.match ? { scores: this.match.scores, dealsPlayed: this.match.dealsPlayed, finished: this.match.finished, winner: this.match.winner } : null,
      round,
      chat: this.chat.slice(),
      history: this.history.slice(),
    };
  }
}

function recordRoundIntoMatch(table: Table, r: RoundState): void {
  table.match = recordRound(table.match!, table.dealIndex, r.passedIn ? null : r.declarer, r.passedIn ? null : r.result);
}

function shortContract(c: RoundState['contract']): string | null {
  if (!c) return null;
  if (c.type === 'grand') return 'G';
  if (c.type === 'null') return 'N';
  return { C: '♣', S: '♠', H: '♥', D: '♦' }[c.suit];
}

// ---- View shapes -----------------------------------------------------------

export interface TableView {
  id: string;
  visibility: 'private' | 'public';
  format: MatchFormat;
  status: TableStatus;
  timed: boolean;
  rated: boolean;
  ranked: boolean;
  dealIndex: number;
  youSlot: number | null;
  players: { slot: number; role: Seat; nick: string | null; occupied: boolean; you: boolean }[];
  match: { scores: number[]; dealsPlayed: number; finished: boolean; winner: number | null } | null;
  round?: RoundView;
  chat: { nick: string; slot: number; text: string }[];
  history: HistoryEntry[];
}

export interface RoundView {
  phase: RoundState['phase'];
  bidding?: { awaiting: string; askerSlot: number; responderSlot: number | null; currentBid: number; lastBidderSlot: number | null; lastActions: ({ kind: 'bid' | 'hold' | 'pass'; value?: number } | null)[] };
  declarerSlot: number | null;
  bid: number;
  tookSkat: boolean;
  declareStep: RoundState['declareStep'];
  contract: RoundState['contract'];
  announcements: RoundState['announcements'];
  turnSlot: number;
  leaderSlot: number;
  trick: { slot: number; card: Card }[];
  trickComplete: boolean;
  lastTrick: { slot: number; card: Card }[];
  lastTrickWinnerSlot: number | null;
  trickCount: number;
  handCounts: number[];
  yourHand: Card[];
  legal: Card[];
  passedIn: boolean;
  result: RoundState['result'];
  skat: [Card, Card] | null;
  banks: number[]; // remaining time-bank reserve per slot (ms)
  turnRemainingMs: number | null; // clock left for the player on turn (ms)
}
