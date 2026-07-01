// The tutorial COACH: given the full engine RoundState and the viewer's role, compute the
// hint data shown to a human learner in a tutorial (untimed practice) table. Runs server-side
// because the hints need the complete state (play history, opponents' accounted cards, point
// tallies) that the redacted client view deliberately omits. It emits raw DATA (card ids,
// a feature name, numbers) -- the friendly wording lives on the client.
import {
  legalCards,
  cardId,
  totalPoints,
  mcEvaluateHand,
  mcEvaluateHand12,
  mcDeclareAction,
  explainCardsScored,
  buildMemory,
  outstandingTrumps,
  explainDiscard,
  DEFAULT_PARAMS,
  type RoundState,
  type Contract,
  type Seat,
  type Card,
  type CardExplanation,
} from '@liskat/engine';

export interface CoachView {
  // bidding (only when it's the viewer's turn to call/respond)
  bidCeil?: number; // hold the auction up to this value (ceilingAny); 0 => pass
  bidContractKey?: string; // the likely game: 'C'|'S'|'H'|'D'|'grand'|'null'
  // declaring (viewer is the declarer)
  takeSkat?: boolean; // 'choose' step: recommend taking the skat
  discardIds?: string[]; // 'discard' step: the two suggested cards to bury
  discardReason?: string; // 'discard' step: why those two ('void'|'tenbare'|'aces'|'' generic)
  contractKey?: string; // 'contract' step: the suggested game key
  // playing (best card(s) only on the viewer's turn)
  bestCards?: { id: string; feature: string }[]; // 1-2 best cards + each's top positive feature
  onlyOption?: boolean; // exactly one legal card
  // playing (always, public-knowledge game info)
  eyesDeclarer?: number;
  eyesDefenders?: number;
  trumpsOut?: number; // trumps not in your hand and not yet played (suit/grand only)
}

const PLAYW = DEFAULT_PARAMS.playW!;

function contractKey(c: Contract): string {
  return c.type === 'suit' ? c.suit : c.type;
}
// A feature may only HEADLINE a card if its learner sentence is actually TRUE for that card. The
// adjective-bearing features assert the card is "long(est)" / "strong" / "high-value", but because
// they carry a positive weight they yield a positive contribution even on a LOW value -- so a
// SINGLETON would wrongly get "leads from your longest side suit" (lead_len_side fires on every
// side card proportional to length). Gate those claims on the underlying value.
function sentenceFits(feat: string, value: number): boolean {
  const prop = /^g_[A-Za-z]+_([a-z]+)$/.exec(feat)?.[1] ?? '';
  // "long(est) suit" (lead_len*, grid *_len): only a genuinely long suit (>=3 cards; value = len/8).
  if (feat === 'lead_len' || feat === 'lead_len_side' || feat === 'lead_len_trump' || prop === 'len') return value >= 0.35;
  // "strong card" (lead_str, grid *_str): only when the card is actually strong (an ace or a trump).
  if (feat === 'lead_str' || prop === 'str') return value >= 0.5;
  // "high-value card" (lead_pts, grid *_pts): only when it really carries points (a king or better).
  if (feat === 'lead_pts' || prop === 'pts') return value >= 0.27;
  return true;
}
// Headline reason = the largest POSITIVE contribution whose sentence is TRUE for the card (the
// contributions are pre-sorted by |contribution| desc). If none qualifies -- a "least-bad" safe low
// card chosen for what it AVOIDS, not a positive virtue -- return '' so the client shows the honest
// generic line rather than a cherry-picked, false-sounding reason.
export function topFeature(e: CardExplanation): string {
  for (const k of e.contributions) if (k.contribution > 0 && sentenceFits(k.feature, k.value)) return k.feature;
  return '';
}
// Headline WHY the learned discard model picked these two cards. Walk its feature contributions
// (|contribution| desc) and return the first interpretable, always-true positive driver: a created
// side-suit void, a banked bare ten, or (null) tucked-away high cards. Anything else -> '' so the
// client shows a neutral line instead of a cherry-picked, false-sounding one (cf. sentenceFits).
function discardReason(a: Card, b: Card, hand12: Card[], contract: Contract): string {
  for (const k of explainDiscard(a, b, hand12, contract, PLAYW)) {
    if (k.contribution <= 0) continue;
    if (k.feature === 'voids' && k.value >= 1) return 'void';
    if (k.feature === 'tenBare' && k.value >= 1) return 'tenbare';
    if (k.feature === 'ace' && k.value >= 1) return 'aces'; // null discard: bury high cards
  }
  return '';
}

export function computeCoach(r: RoundState, role: Seat): CoachView {
  const c: CoachView = {};

  if (r.phase === 'bidding') {
    const b = r.bidding;
    const toAct = b.awaiting === 'response' ? b.responder : b.awaiting === 'forehand-decision' ? (0 as Seat) : b.asker;
    if (toAct === role) {
      const ev = mcEvaluateHand(r.hands[role]);
      c.bidCeil = ev.ceilingAny;
      c.bidContractKey = contractKey(ev.contract);
    }
    return c;
  }

  if (r.phase === 'declaring' && r.declarer === role) {
    if (r.declareStep === 'choose') {
      // Recommend taking the skat vs playing a hand game.
      const sug = mcDeclareAction(r, role, DEFAULT_PARAMS);
      if (sug && (sug.type === 'takeSkat' || sug.type === 'playHand')) c.takeSkat = sug.type === 'takeSkat';
    } else if (r.declareStep === 'discard') {
      // The UI merges discard + game choice into this step, so surface BOTH: the two cards to
      // bury, and the recommended game (the bot's intended contract for the 12-card hand).
      const sug = mcDeclareAction(r, role, DEFAULT_PARAMS);
      const intended = mcEvaluateHand12(r.hands[role]).contract;
      if (sug && sug.type === 'discard') {
        c.discardIds = sug.cards.map(cardId);
        c.discardReason = discardReason(sug.cards[0], sug.cards[1], r.hands[role], intended);
      }
      c.contractKey = contractKey(intended);
    } else if (r.declareStep === 'contract') {
      // Hand game (skat declined): only the game is chosen here.
      const sug = mcDeclareAction(r, role, DEFAULT_PARAMS);
      if (sug && sug.type === 'declareContract') c.contractKey = contractKey(sug.contract);
    }
    return c;
  }

  if (r.phase === 'playing') {
    // Public-knowledge running info, shown whoever is on turn.
    c.eyesDeclarer = totalPoints(r.declarerTrickPoints);
    c.eyesDefenders = totalPoints(r.defenderTrickPoints);
    if (r.contract && r.contract.type !== 'null') {
      const mem = buildMemory(r, r.contract);
      c.trumpsOut = outstandingTrumps(r.hands[role], mem, r.contract, role === r.declarer ? r.skat : []).length;
    }
    // Best-card hint only when it's actually the viewer's move.
    if (r.turn === role && !r.trickComplete) {
      const legal = legalCards(r, role);
      if (legal.length === 1) {
        c.onlyOption = true;
        c.bestCards = [{ id: cardId(legal[0]), feature: '' }];
      } else if (legal.length > 1) {
        const expl = explainCardsScored(r, role, legal, PLAYW);
        let best = 0;
        for (let i = 1; i < expl.length; i++) if (expl[i].score > expl[best].score) best = i;
        let worst = 0;
        for (let i = 1; i < expl.length; i++) if (expl[i].score < expl[worst].score) worst = i;
        let second = -1;
        for (let i = 0; i < expl.length; i++) if (i !== best && (second < 0 || expl[i].score > expl[second].score)) second = i;
        const range = expl[best].score - expl[worst].score;
        const closeSecond = second >= 0 && range > 0 && expl[best].score - expl[second].score < 0.25 * range;
        c.bestCards = [{ id: cardId(legal[best]), feature: topFeature(expl[best]) }];
        if (closeSecond) c.bestCards.push({ id: cardId(legal[second]), feature: topFeature(expl[second]) });
      }
    }
    return c;
  }

  return c;
}
