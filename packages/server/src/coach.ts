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
  DEFAULT_PARAMS,
  type RoundState,
  type Contract,
  type Seat,
  type CardExplanation,
} from '@liskat/engine';

export interface CoachView {
  // bidding (only when it's the viewer's turn to call/respond)
  bidCeil?: number; // hold the auction up to this value (ceilingAny); 0 => pass
  bidContractKey?: string; // the likely game: 'C'|'S'|'H'|'D'|'grand'|'null'
  // declaring (viewer is the declarer)
  takeSkat?: boolean; // 'choose' step: recommend taking the skat
  discardIds?: string[]; // 'discard' step: the two suggested cards to bury
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
// Top POSITIVE feature on a card's score = the headline reason it's good. Contributions are
// already sorted by |contribution| descending; fall back to the largest term if none positive.
function topFeature(e: CardExplanation): string {
  for (const k of e.contributions) if (k.contribution > 0) return k.feature;
  return e.contributions[0]?.feature ?? '';
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
      if (sug && sug.type === 'discard') c.discardIds = sug.cards.map(cardId);
      c.contractKey = contractKey(mcEvaluateHand12(r.hands[role]).contract);
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
