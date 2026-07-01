// Post-game REVIEW: turn a finished deal's compact DealReplay into a step-through
// payload for the client. We deterministically re-derive the RoundState at every
// point of the deal with the engine's own reducer (createRound + applyAction), so
// we can, at each play ply, ask the learned bot what it would have played and why
// (explainCardsScored + the same headline gate the tutorial coach uses).
//
// Everything here is slot-indexed (as the DealReplay already is) so the client can
// render it directly without any seat<->slot juggling.
import {
  createRound,
  applyAction,
  legalCards,
  explainCardsScored,
  cardFromId,
  cardId,
  DEFAULT_PARAMS,
  type Deal,
  type Card,
  type Seat,
  type Contract,
  type RoundState,
} from '@liskat/engine';
import { topFeature } from './coach.ts';
import type { DealReplay } from './history.ts';

// Same seat<->slot rotation the table uses when it records a replay (table.ts).
const roleOfSlot = (slot: number, dealIndex: number): Seat => ((((slot - dealIndex) % 3) + 3) % 3) as Seat;
const slotOfRole = (role: Seat, dealIndex: number): number => (dealIndex + role) % 3;

const PLAYW = DEFAULT_PARAMS.playW!;

export interface ReviewPly {
  trick: number; // 0-based trick index
  pos: number; // 0..2 position within the trick
  slot: number; // who played this card
  card: string; // card id played
  bestCard?: string; // the card the bot would have played (omitted when only one legal card)
  bestFeature?: string; // engine feature name behind the bot's pick (client turns it into wording)
}

export interface ReviewDeal {
  deal: number;
  dealerSlot: number;
  viewerSlot: number; // which slot is "you" (rendered as the bottom hand)
  hands: string[][]; // slot-indexed dealt hands (10 cards each), face up
  skat: string[];
  discard: string[] | null;
  tookSkat: boolean;
  declarerSlot: number | null;
  contract: { type: 'suit' | 'grand' | 'null'; suit?: string } | null;
  ouvert?: boolean;
  tricks: { leader: number; cards: string[]; winner: number }[];
  result: DealReplay['result'];
  scores: number[];
  passedIn: boolean;
  plies: ReviewPly[];
}

// Reconstruct the RoundState up through declaring, then walk the tricks, capturing
// the bot's recommended card before each real card is applied.
export function buildReviewDeal(replay: DealReplay, viewerSlot: number): ReviewDeal {
  const dealIndex = replay.deal - 1;
  const plies: ReviewPly[] = [];

  const base: ReviewDeal = {
    deal: replay.deal,
    dealerSlot: replay.dealerSlot,
    viewerSlot: viewerSlot >= 0 ? viewerSlot : 0,
    hands: replay.hands,
    skat: replay.skat,
    discard: replay.discard,
    tookSkat: replay.tookSkat,
    declarerSlot: replay.declarerSlot,
    contract: replay.contract,
    ouvert: replay.ouvert,
    tricks: replay.tricks,
    result: replay.result,
    scores: replay.scores,
    passedIn: replay.passedIn,
    plies,
  };

  // A passed-in deal (everyone passed) has no play to step through.
  if (replay.passedIn || replay.declarerSlot === null || !replay.contract) return base;

  // Seat-indexed deal from the slot-indexed replay.
  const handsBySeat: [Card[], Card[], Card[]] = [[], [], []];
  for (let slot = 0; slot < 3; slot++) handsBySeat[roleOfSlot(slot, dealIndex)] = replay.hands[slot].map(cardFromId);
  const deal: Deal = {
    hands: handsBySeat,
    skat: [cardFromId(replay.skat[0]), cardFromId(replay.skat[1])],
  };

  let s: RoundState = createRound(deal);

  // Replay the auction verbatim — these are the exact actions the reducer accepted.
  for (const b of replay.bids) {
    const seat = roleOfSlot(b.slot, dealIndex);
    if (b.kind === 'bid') s = applyAction(s, { type: 'bid', seat, value: b.value! });
    else if (b.kind === 'hold') s = applyAction(s, { type: 'hold', seat });
    else s = applyAction(s, { type: 'pass', seat });
  }

  // Declaring: take skat / play hand, discard, then name the game.
  const declarer = roleOfSlot(replay.declarerSlot, dealIndex);
  s = applyAction(s, { type: replay.tookSkat ? 'takeSkat' : 'playHand', seat: declarer });
  if (replay.tookSkat && replay.discard) {
    s = applyAction(s, {
      type: 'discard',
      seat: declarer,
      cards: [cardFromId(replay.discard[0]), cardFromId(replay.discard[1])],
    });
  }
  const contract = replay.contract as Contract;
  // The replay only stores `ouvert`; a hand suit/grand ouvert requires schwarz (and
  // thus schneider) to be announced or the reducer rejects it. Other announcements
  // don't affect card legality and we display replay.result, so this stays faithful.
  const ann: { ouvert?: boolean; schneiderAnnounced?: boolean; schwarzAnnounced?: boolean } = {};
  if (replay.ouvert) {
    ann.ouvert = true;
    if (contract.type !== 'null' && !replay.tookSkat) {
      ann.schneiderAnnounced = true;
      ann.schwarzAnnounced = true;
    }
  }
  s = applyAction(s, { type: 'declareContract', seat: declarer, contract, announcements: ann });

  // Walk each trick, recording the bot's pick before every real card.
  for (let t = 0; t < replay.tricks.length; t++) {
    const cards = replay.tricks[t].cards;
    for (let pos = 0; pos < cards.length; pos++) {
      const seat = s.turn;
      const card = cardFromId(cards[pos]);
      const legal = legalCards(s, seat);
      const ply: ReviewPly = { trick: t, pos, slot: slotOfRole(seat, dealIndex), card: cards[pos] };
      if (legal.length > 1) {
        const expl = explainCardsScored(s, seat, legal, PLAYW);
        let best = 0;
        for (let i = 1; i < expl.length; i++) if (expl[i].score > expl[best].score) best = i;
        ply.bestCard = cardId(legal[best]);
        const feat = topFeature(expl[best]);
        if (feat) ply.bestFeature = feat;
      }
      plies.push(ply);
      s = applyAction(s, { type: 'playCard', seat, card });
      if (s.trickComplete) s = applyAction(s, { type: 'collect' });
    }
  }

  return base;
}
