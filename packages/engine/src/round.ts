// The full state machine for a single Skat round (one deal), from the bidding
// auction through declaring, the ten tricks of play, and final scoring.
//
// Seats are roles in play order for THIS round: 0 = forehand (leads first
// trick), 1 = middlehand, 2 = rearhand. A match layer above rotates which
// physical player holds each role each deal. The reducer is pure: applyAction
// returns a new state and throws on an illegal action (the server validates).

import type { Card, Contract, Seat } from './types.ts';
import { cardPoints, cardsEqual, totalPoints } from './cards.ts';
import { leadSuit, trickWinner } from './ordering.ts';
import { isLegalBid } from './bidding.ts';
import {
  computeGameValue,
  type Announcements,
  type GameValueResult,
} from './scoring.ts';
import type { Deal } from './deal.ts';

export type Phase = 'bidding' | 'declaring' | 'playing' | 'finished';

// Each player's most recent utterance in the auction, for display under them.
export interface BidAnnounce {
  kind: 'bid' | 'hold' | 'pass';
  value?: number;
}

interface BiddingState {
  stage: 1 | 2;
  asker: Seat;
  responder: Seat | null; // null during the forehand decision
  awaiting: 'call' | 'response' | 'forehand-decision';
  currentBid: number;
  passed: [boolean, boolean, boolean];
  stage1Winner: Seat | null;
  lastBidderSeat: Seat | null; // who named the current bid value
  lastActions: (BidAnnounce | null)[]; // indexed by seat
}

export type DeclareStep = 'choose' | 'discard' | 'contract' | 'done';

export interface RoundState {
  phase: Phase;
  hands: [Card[], Card[], Card[]];
  skat: [Card, Card]; // belongs to the declarer; counts for their points (the discard, once they've discarded)
  skatDealt: [Card, Card]; // the two cards originally dealt to the skat (skat above is overwritten by the discard)
  bidding: BiddingState;

  declarer: Seat | null;
  bid: number; // the winning bid value
  tookSkat: boolean;
  declareStep: DeclareStep;
  contract: Contract | null;
  announcements: Announcements;
  declarerGameCards: Card[]; // declarer's 12 cards (hand + skat), for matadors

  // play
  leader: Seat;
  turn: Seat;
  trick: { seat: Seat; card: Card }[];
  trickComplete: boolean; // all three cards played, awaiting collection
  trickWinnerSeat: Seat | null; // winner of the completed-but-uncollected trick
  lastTrick: { seat: Seat; card: Card }[]; // the previous, collected trick (for display)
  lastTrickWinner: Seat | null;
  completedTricks: { seat: Seat; card: Card }[][]; // every collected trick in play order (lead first): full public play history for memory/inference
  trickCount: number;
  declarerTrickPoints: Card[];
  defenderTrickPoints: Card[];
  declarerTricksWon: number;
  defenderTricksWon: number;

  passedIn: boolean; // everyone passed; no game is played
  result: GameValueResult | null;
}

export type Action =
  | { type: 'bid'; seat: Seat; value: number }
  | { type: 'hold'; seat: Seat }
  | { type: 'pass'; seat: Seat }
  | { type: 'takeSkat'; seat: Seat }
  | { type: 'playHand'; seat: Seat }
  | { type: 'discard'; seat: Seat; cards: [Card, Card] }
  | { type: 'declareContract'; seat: Seat; contract: Contract; announcements?: Partial<Announcements> }
  | { type: 'playCard'; seat: Seat; card: Card }
  | { type: 'collect' }; // sweep the completed trick to its winner (no seat: a presentation step)

const NEXT: Record<Seat, Seat> = { 0: 1, 1: 2, 2: 0 };
const NO_ANN: Announcements = { hand: false, schneiderAnnounced: false, schwarzAnnounced: false, ouvert: false };

export function createRound(d: Deal): RoundState {
  return {
    phase: 'bidding',
    hands: [d.hands[0].slice(), d.hands[1].slice(), d.hands[2].slice()],
    skat: [d.skat[0], d.skat[1]],
    skatDealt: [d.skat[0], d.skat[1]],
    bidding: {
      stage: 1,
      asker: 1, // middlehand calls to forehand
      responder: 0,
      awaiting: 'call',
      currentBid: 0,
      passed: [false, false, false],
      stage1Winner: null,
      lastBidderSeat: null,
      lastActions: [null, null, null],
    },
    declarer: null,
    bid: 0,
    tookSkat: false,
    declareStep: 'choose',
    contract: null,
    announcements: { ...NO_ANN },
    declarerGameCards: [],
    leader: 0,
    turn: 0,
    trick: [],
    trickComplete: false,
    trickWinnerSeat: null,
    lastTrick: [],
    lastTrickWinner: null,
    completedTricks: [],
    trickCount: 0,
    declarerTrickPoints: [],
    defenderTrickPoints: [],
    declarerTricksWon: 0,
    defenderTricksWon: 0,
    passedIn: false,
    result: null,
  };
}

function fail(msg: string): never {
  throw new Error(`illegal action: ${msg}`);
}

// Returns a shallow-cloned state to keep the reducer pure-ish for callers.
function clone(s: RoundState): RoundState {
  return {
    ...s,
    hands: [s.hands[0].slice(), s.hands[1].slice(), s.hands[2].slice()],
    bidding: { ...s.bidding, passed: [...s.bidding.passed] as [boolean, boolean, boolean], lastActions: [...s.bidding.lastActions] },
    announcements: { ...s.announcements },
    trick: s.trick.slice(),
    lastTrick: s.lastTrick.slice(),
    completedTricks: s.completedTricks.map((t) => t.slice()),
    declarerTrickPoints: s.declarerTrickPoints.slice(),
    defenderTrickPoints: s.defenderTrickPoints.slice(),
    declarerGameCards: s.declarerGameCards.slice(),
  };
}

export function applyAction(state: RoundState, action: Action): RoundState {
  const s = clone(state);
  switch (s.phase) {
    case 'bidding':
      return applyBidding(s, action);
    case 'declaring':
      return applyDeclaring(s, action);
    case 'playing':
      return applyPlaying(s, action);
    case 'finished':
      return fail('round is finished');
  }
}

// ---- Bidding ---------------------------------------------------------------

function applyBidding(s: RoundState, a: Action): RoundState {
  const b = s.bidding;
  if (b.awaiting === 'forehand-decision') {
    if (a.seat !== 0) fail('only forehand decides here');
    if (a.type === 'bid') {
      if (!isLegalBid(a.value)) fail('not a legal bid value');
      s.bidding.lastBidderSeat = 0;
      s.bidding.lastActions[0] = { kind: 'bid', value: a.value };
      s.declarer = 0;
      s.bid = a.value;
      return enterDeclaring(s);
    }
    if (a.type === 'pass') {
      s.passedIn = true;
      s.phase = 'finished';
      return s;
    }
    return fail('expected bid or pass from forehand');
  }

  if (a.type === 'bid') {
    if (b.awaiting !== 'call') fail('not your turn to call');
    if (a.seat !== b.asker) fail('not the asker');
    if (!isLegalBid(a.value)) fail('not a legal bid value');
    if (a.value <= b.currentBid) fail('bid must be higher');
    b.currentBid = a.value;
    b.lastBidderSeat = a.seat;
    b.lastActions[a.seat] = { kind: 'bid', value: a.value };
    b.awaiting = 'response';
    return s;
  }

  if (a.type === 'hold') {
    if (b.awaiting !== 'response') fail('nothing to hold');
    if (a.seat !== b.responder) fail('not the responder');
    b.lastActions[a.seat] = { kind: 'hold', value: b.currentBid };
    b.awaiting = 'call'; // asker must now raise or pass
    return s;
  }

  if (a.type === 'pass') {
    if (b.awaiting === 'call') {
      if (a.seat !== b.asker) fail('not the asker');
      b.lastActions[a.seat] = { kind: 'pass' };
      // asker concedes: the responder wins this stage at currentBid
      return resolveStage(s, b.responder!);
    }
    if (b.awaiting === 'response') {
      if (a.seat !== b.responder) fail('not the responder');
      b.lastActions[a.seat] = { kind: 'pass' };
      // responder concedes: the asker wins this stage at currentBid
      return resolveStage(s, b.asker);
    }
  }

  return fail('unexpected action during bidding');
}

function resolveStage(s: RoundState, winner: Seat): RoundState {
  const b = s.bidding;
  if (b.stage === 1) {
    const loser = b.asker === winner ? b.responder! : b.asker;
    b.passed[loser] = true;
    b.stage1Winner = winner;
    b.stage = 2;
    b.asker = 2; // rearhand
    b.responder = winner;
    b.awaiting = 'call';
    // currentBid carries over: rearhand must outbid what the winner holds
    return s;
  }
  // stage 2: `winner` is the declarer
  const loser = b.asker === winner ? b.responder! : b.asker;
  b.passed[loser] = true;
  if (b.currentBid === 0) {
    // Everyone passed without a value; forehand may opt in at a chosen value.
    b.awaiting = 'forehand-decision';
    b.asker = 0;
    b.responder = null;
    return s;
  }
  s.declarer = winner;
  s.bid = b.currentBid;
  return enterDeclaring(s);
}

// ---- Declaring -------------------------------------------------------------

function enterDeclaring(s: RoundState): RoundState {
  s.phase = 'declaring';
  s.declareStep = 'choose';
  return s;
}

function applyDeclaring(s: RoundState, a: Action): RoundState {
  if (a.seat !== s.declarer) fail('only the declarer acts now');

  if (a.type === 'takeSkat') {
    if (s.declareStep !== 'choose') fail('skat already decided');
    s.hands[s.declarer!].push(s.skat[0], s.skat[1]);
    s.tookSkat = true;
    s.declareStep = 'discard';
    return s;
  }

  if (a.type === 'playHand') {
    if (s.declareStep !== 'choose') fail('skat already decided');
    s.tookSkat = false;
    s.declareStep = 'contract';
    return s;
  }

  if (a.type === 'discard') {
    if (s.declareStep !== 'discard') fail('not discarding now');
    const hand = s.hands[s.declarer!];
    for (const c of a.cards) {
      const i = hand.findIndex((h) => cardsEqual(h, c));
      if (i < 0) fail('cannot discard a card not in hand');
      hand.splice(i, 1);
    }
    s.skat = [a.cards[0], a.cards[1]]; // discarded cards become the skat, count for declarer
    s.declareStep = 'contract';
    return s;
  }

  if (a.type === 'declareContract') {
    if (s.declareStep !== 'contract') fail('not ready to declare contract');
    const ann: Announcements = { ...NO_ANN, ...a.announcements, hand: !s.tookSkat };
    validateAnnouncements(s, a.contract, ann);
    s.contract = a.contract;
    s.announcements = ann;
    s.declareStep = 'done';
    s.declarerGameCards = [...s.hands[s.declarer!], ...s.skat];
    s.phase = 'playing';
    s.leader = 0;
    s.turn = 0;
    return s;
  }

  return fail('unexpected action during declaring');
}

function validateAnnouncements(s: RoundState, contract: Contract, ann: Announcements): void {
  if (!s.tookSkat) {
    // hand game: schneider/schwarz announcements only for suit/grand
    if ((ann.schneiderAnnounced || ann.schwarzAnnounced) && contract.type === 'null') {
      fail('cannot announce schneider/schwarz in a null game');
    }
    if (ann.schwarzAnnounced && !ann.schneiderAnnounced && contract.type !== 'null') {
      fail('schwarz announcement implies schneider');
    }
    if (ann.ouvert && contract.type !== 'null' && !ann.schwarzAnnounced) {
      fail('ouvert in a suit/grand game requires an announced schwarz');
    }
  } else {
    // took the skat: no hand-only announcements; only null may be ouvert
    if (ann.schneiderAnnounced || ann.schwarzAnnounced) fail('no announcements after taking the skat');
    if (ann.ouvert && contract.type !== 'null') fail('only null may be ouvert after taking the skat');
  }
}

// ---- Playing ---------------------------------------------------------------

// The cards the player at `seat` is allowed to play right now.
export function legalCards(s: RoundState, seat: Seat): Card[] {
  if (s.phase !== 'playing' || s.trickComplete || seat !== s.turn) return [];
  const hand = s.hands[seat];
  if (s.trick.length === 0) return hand.slice();
  const led = leadSuit(s.trick[0].card, s.contract!);
  const following = hand.filter((c) => leadSuit(c, s.contract!) === led);
  return following.length > 0 ? following : hand.slice();
}

function applyPlaying(s: RoundState, a: Action): RoundState {
  if (a.type === 'collect') return collectTrick(s);
  if (a.type !== 'playCard') fail('only card play is allowed now');
  if (s.trickComplete) fail('the completed trick must be collected first');
  if (a.seat !== s.turn) fail('not your turn');
  const legal = legalCards(s, a.seat);
  if (!legal.some((c) => cardsEqual(c, a.card))) fail('that card is not playable (must follow suit)');

  const hand = s.hands[a.seat];
  hand.splice(hand.findIndex((c) => cardsEqual(c, a.card)), 1);
  s.trick.push({ seat: a.seat, card: a.card });

  if (s.trick.length < 3) {
    s.turn = NEXT[a.seat];
    return s;
  }

  // Third card: the trick is complete but stays on the table until collected,
  // so the winning play is visible for a beat.
  const winIdx = trickWinner(s.trick.map((t) => t.card), s.contract!);
  s.trickWinnerSeat = s.trick[winIdx].seat;
  s.trickComplete = true;
  return s;
}

// Sweeps a completed trick to its winner and sets up the next lead.
function collectTrick(s: RoundState): RoundState {
  if (!s.trickComplete || s.trickWinnerSeat === null) fail('no completed trick to collect');
  const winnerSeat = s.trickWinnerSeat;
  const cards = s.trick.map((t) => t.card);
  if (winnerSeat === s.declarer) {
    s.declarerTrickPoints.push(...cards);
    s.declarerTricksWon += 1;
  } else {
    s.defenderTrickPoints.push(...cards);
    s.defenderTricksWon += 1;
  }
  s.lastTrick = s.trick.map((t) => ({ seat: t.seat, card: t.card }));
  s.lastTrickWinner = winnerSeat;
  s.completedTricks.push(s.trick.map((t) => ({ seat: t.seat, card: t.card })));
  s.trick = [];
  s.trickComplete = false;
  s.trickWinnerSeat = null;
  s.leader = winnerSeat;
  s.turn = winnerSeat;
  s.trickCount += 1;

  // In a Null game the declarer must lose every trick; taking one ends the
  // game immediately as a loss.
  if (s.contract?.type === 'null' && winnerSeat === s.declarer) return finishRound(s);
  if (s.trickCount === 10) return finishRound(s);
  return s;
}

function finishRound(s: RoundState): RoundState {
  const declarerCardPoints = totalPoints(s.declarerTrickPoints) + s.skat.reduce((n, c) => n + cardPoints(c), 0);
  s.result = computeGameValue(
    s.contract!,
    s.declarerGameCards,
    {
      declarerCardPoints,
      defenderTricks: s.defenderTricksWon,
      declarerWonATrick: s.declarerTricksWon > 0,
    },
    s.announcements,
    s.bid,
  );
  s.phase = 'finished';
  return s;
}
