// A simple heuristic Skat bot, strong enough to give a human useful practice
// but deliberately not an expert. Given a round state and the seat to act for,
// it returns one legal Action for every phase (bidding, declaring, play).
//
// The bot only ever looks at its OWN hand plus public information (the cards on
// the table, the cards already played, and (when it is the declarer) its own
// skat discard). It does not peek at the opponents' hands, so it plays fair.
//
// The bidding and play heuristics follow common club-level guidance:
//  - bid a suit game with 6+ trumps (or 5 trumps with strong support: two side
//    aces, or a side ace and two jacks); a grand only with real top-card power
//    (three jacks and an ace, or two jacks with three aces and the club jack); a
//    null with a hand full of low cards and no ace.
//  - as declarer, draw the opponents' trumps first; cash side aces afterwards.
//  - as a defender on lead, cash your winners (side aces, and tens once their ace
//    is gone), and when your partner sits behind the declarer lead a king/queen up
//    to them; otherwise only "break in" (trump in / overtake) with enough trumps
//    or when the trick is already worth something, ducking low the rest of the
//    time and giving your partner points ("schmieren") when it is safe to do so.

import type { Card, Contract, Seat, Suit } from './types.ts';
import { SUITS } from './types.ts';
import type { RoundState, Action } from './round.ts';
import { legalCards } from './round.ts';
import { cardId, cardPoints, totalPoints } from './cards.ts';
import { isTrump, leadSuit, trickWinner, trumpsHighToLow } from './ordering.ts';
import { countMatadors, previewGameValue } from './scoring.ts';
import { nextBid } from './bidding.ts';

// The single entry point: a legal move for `seat` in the current state, or null
// if it is not that seat's turn / nothing to do.
export function decideBotAction(s: RoundState, seat: Seat): Action | null {
  switch (s.phase) {
    case 'bidding':
      return decideBidding(s, seat);
    case 'declaring':
      return decideDeclaring(s, seat);
    case 'playing':
      return decidePlay(s, seat);
    default:
      return null;
  }
}

// ---- Hand evaluation -------------------------------------------------------

interface GamePlan {
  contract: Contract;
  value: number; // estimated game value, used as the bidding ceiling
  hand: boolean; // play without taking the skat (only chosen for a strong null)
}

// The value the engine would score a contract at, given the trump-relevant
// cards the declarer holds. Mirrors the real scoring so the bot never overbids
// its own estimate.
function gameValue(contract: Contract, cards: Card[], hand: boolean): number {
  if (contract.type === 'null') return previewGameValue(contract, 0, { hand });
  return previewGameValue(contract, countMatadors(cards, contract), { hand });
}

// The best game this hand can play, or null if nothing is worth bidding. Called
// during the auction (10 cards) and again after the skat (12 cards).
function evaluate(hand: Card[]): GamePlan | null {
  const plans: GamePlan[] = [];

  for (const suit of SUITS) {
    const contract: Contract = { type: 'suit', suit };
    const trumps = hand.filter((c) => isTrump(c, contract)).length;
    const sideAces = hand.filter((c) => c.rank === 'A' && c.suit !== suit).length;
    const jacks = hand.filter((c) => c.rank === 'J').length;
    if (trumps >= 6 || (trumps === 5 && (sideAces >= 2 || (sideAces >= 1 && jacks >= 2)))) {
      plans.push({ contract, value: gameValue(contract, hand, false), hand: false });
    }
  }

  {
    // Grand lives on jacks and aces. Three jacks plus an ace is a sound grand;
    // with only two jacks you need a fistful of aces behind them (the opponents
    // hold the other two jacks, so thin grands go down), and the top jack (clubs)
    // to be sure of the trump lead. Jack-rich but ace-poor hands go down too often.
    const jacks = hand.filter((c) => c.rank === 'J').length;
    const aces = hand.filter((c) => c.rank === 'A').length;
    const hasClubJack = hand.some((c) => c.rank === 'J' && c.suit === 'C');
    if ((jacks >= 3 && aces >= 1) || (jacks >= 2 && aces >= 3 && hasClubJack)) {
      const contract: Contract = { type: 'grand' };
      plans.push({ contract, value: gameValue(contract, hand, false), hand: false });
    }
  }

  {
    // A null needs to duck every trick, so an ace (which can never go under
    // another card) is a liability; only bid null with none, and only when most
    // of the hand is low.
    const lows = hand.filter((c) => c.rank === '7' || c.rank === '8' || c.rank === '9').length;
    const aces = hand.filter((c) => c.rank === 'A').length;
    const contract: Contract = { type: 'null' };
    if (aces === 0) {
      if (lows >= 8) plans.push({ contract, value: gameValue(contract, hand, true), hand: true });
      else if (lows >= 7) plans.push({ contract, value: gameValue(contract, hand, false), hand: false });
    }
  }

  if (plans.length === 0) return null;
  plans.sort((a, b) => b.value - a.value);
  return plans[0];
}

// ---- Bidding ---------------------------------------------------------------

function decideBidding(s: RoundState, seat: Seat): Action {
  const ceiling = evaluate(s.hands[seat])?.value ?? 0;
  const b = s.bidding;

  // Forehand may open the auction at a value when everyone else passed out.
  if (b.awaiting === 'forehand-decision') {
    return ceiling >= 18 ? { type: 'bid', seat, value: 18 } : { type: 'pass', seat };
  }
  // Responding to a call: hold (accept the value) while it's within our ceiling.
  if (b.awaiting === 'response') {
    return b.currentBid <= ceiling ? { type: 'hold', seat } : { type: 'pass', seat };
  }
  // Calling: raise to the next legal value if we can still afford it.
  const v = nextBid(b.currentBid);
  if (v !== null && v <= ceiling) return { type: 'bid', seat, value: v };
  return { type: 'pass', seat };
}

// ---- Declaring -------------------------------------------------------------

function decideDeclaring(s: RoundState, seat: Seat): Action | null {
  const hand = s.hands[seat];

  if (s.declareStep === 'choose') {
    // Take the skat unless the hand is a strong enough null to play closed.
    const plan = evaluate(hand);
    return plan?.hand ? { type: 'playHand', seat } : { type: 'takeSkat', seat };
  }

  if (s.declareStep === 'discard') {
    const contract = chooseFinalContract(hand, s.bid, !s.tookSkat);
    return { type: 'discard', seat, cards: chooseDiscards(hand, contract) };
  }

  if (s.declareStep === 'contract') {
    return { type: 'declareContract', seat, contract: chooseFinalContract(hand, s.bid, !s.tookSkat) };
  }

  return null;
}

// The game to declare: the hand's natural best game when it covers the bid,
// otherwise the cheapest game that does (so we are not charged for an overbid we
// could have avoided).
function chooseFinalContract(hand: Card[], bid: number, isHand: boolean): Contract {
  const plan = evaluate(hand);
  if (plan && gameValue(plan.contract, hand, isHand) >= bid) return plan.contract;

  const candidates: Contract[] = [
    { type: 'grand' },
    ...SUITS.map((suit) => ({ type: 'suit', suit }) as Contract),
  ];
  let best: { c: Contract; v: number } | null = null;
  for (const c of candidates) {
    const v = gameValue(c, hand, isHand);
    if (v >= bid && (!best || v < best.v)) best = { c, v };
  }
  return best?.c ?? plan?.contract ?? { type: 'suit', suit: 'C' };
}

// Two cards to lay away. In a trump game shed the lowest side cards, preferring
// to empty a short suit so it can be trumped later; never throw away an ace. In
// a null game shed the two most dangerous (highest) cards.
function chooseDiscards(hand: Card[], contract: Contract): [Card, Card] {
  if (contract.type === 'null') {
    const byDanger = [...hand].sort((a, b) => cardStrength(b, contract) - cardStrength(a, contract));
    return [byDanger[0], byDanger[1]];
  }

  const nonTrumps = hand.filter((c) => !isTrump(c, contract));
  const suitLen: Record<string, number> = {};
  for (const c of nonTrumps) suitLen[c.suit] = (suitLen[c.suit] ?? 0) + 1;
  const ranked = [...nonTrumps].sort(
    (a, b) =>
      cardPoints(a) - cardPoints(b) || // fewest points first
      suitLen[a.suit] - suitLen[b.suit] || // then from the shortest suit (to void it)
      cardStrength(a, contract) - cardStrength(b, contract),
  );

  const pick = ranked.slice(0, 2);
  if (pick.length < 2) {
    // Almost all trumps: fall back to laying away the lowest trumps.
    const lowTrumps = hand.filter((c) => isTrump(c, contract)).sort((a, b) => cardStrength(a, contract) - cardStrength(b, contract));
    for (const t of lowTrumps) if (pick.length < 2 && !pick.includes(t)) pick.push(t);
  }
  return [pick[0], pick[1]];
}

// ---- Play ------------------------------------------------------------------

function decidePlay(s: RoundState, seat: Seat): Action | null {
  const legal = legalCards(s, seat);
  if (legal.length === 0) return null;
  if (legal.length === 1) return { type: 'playCard', seat, card: legal[0] };
  return { type: 'playCard', seat, card: chooseCard(s, seat, legal) };
}

function chooseCard(s: RoundState, seat: Seat, legal: Card[]): Card {
  const contract = s.contract!;
  const hand = s.hands[seat];
  const trick = s.trick;
  const amDeclarer = s.declarer === seat;

  // Null is its own world: no trumps, and the declarer must LOSE every trick.
  if (contract.type === 'null') {
    if (trick.length === 0) return cheapest(legal, contract); // lead low
    const tc = trick.map((t) => t.card);
    const ducks = legal.filter((card) => !wouldWin(tc, card, contract));
    if (amDeclarer) {
      // Stay under the trick; shed the highest card that still loses so we're not
      // stranded with a winner later. If we can't duck, the game is already lost.
      return ducks.length ? dearest(ducks, contract) : dearest(legal, contract);
    }
    // Defender: duck low to keep high cards back, otherwise take it cheaply.
    return ducks.length ? cheapest(ducks, contract) : cheapest(legal, contract);
  }

  // Trumps still out in the opponents' hands (best-effort): all trumps minus the
  // ones we hold and the ones already played (and, for the declarer, the skat).
  const out = new Set<string>([...s.declarerTrickPoints, ...s.defenderTrickPoints, ...trick.map((t) => t.card)].map(cardId));
  if (amDeclarer) for (const c of s.skat) out.add(cardId(c));
  const mine = new Set(hand.map(cardId));
  const outstanding = trumpsHighToLow(contract).filter((t) => !mine.has(cardId(t)) && !out.has(cardId(t)));

  // ---- Leading a trick ----
  if (trick.length === 0) {
    if (amDeclarer) {
      const myTrumps = hand.filter((c) => isTrump(c, contract)).sort((a, b) => cardStrength(b, contract) - cardStrength(a, contract));
      if (myTrumps.length > 0 && outstanding.length > 0) {
        // Hold the master trump? Lead it. Otherwise lead a low trump (never the
        // trump ace or ten) to force the opponents to follow.
        if (cardStrength(myTrumps[0], contract) > cardStrength(outstanding[0], contract)) return myTrumps[0];
        const low = myTrumps.filter((c) => c.rank !== 'A' && c.rank !== '10');
        const pool = low.length ? low : myTrumps;
        return pool[pool.length - 1];
      }
      return cashOrDump(hand, contract);
    }
    return leadAsDefender(s, seat, hand, contract);
  }

  // ---- Following a trick ----
  const trickCards = trick.map((t) => t.card);
  const led = leadSuit(trickCards[0], contract);
  const winnerSeat = trick[trickWinner(trickCards, contract)].seat;
  const trickValue = totalPoints(trickCards);
  const isLast = trick.length === 2;
  const winners = legal.filter((c) => wouldWin(trickCards, c, contract));
  const myTrumpCount = hand.filter((c) => isTrump(c, contract)).length;

  if (amDeclarer) {
    if (winners.length > 0) {
      const cheap = cheapest(winners, contract);
      const trumpingIn = isTrump(cheap, contract) && led !== 'T';
      // Win cheaply, but don't waste a trump on a worthless side-suit trick.
      if (!trumpingIn || trickValue >= 4 || isLast) return cheap;
    }
    return lowCard(legal, contract);
  }

  // Defender.
  const declarerWinning = winnerSeat === s.declarer;
  if (!declarerWinning) {
    // Our partner is winning: hand them points when it's safe (we play last).
    return isLast ? highestPoints(legal) : lowCard(legal, contract);
  }
  // Declarer is winning. Overtake cheaply in the led suit for free; only spend a
  // trump ("break in") with enough trumps or when the trick is already valuable.
  const suitOvertake = winners.filter((c) => led !== 'T' && !isTrump(c, contract));
  if (suitOvertake.length > 0) return cheapest(suitOvertake, contract);
  const trumpWin = winners.filter((c) => isTrump(c, contract));
  if (trumpWin.length > 0 && (myTrumpCount >= 3 || trickValue >= 8)) return cheapest(trumpWin, contract);
  return lowCard(legal, contract);
}

// Declarer with no trumps to pull: cash a side ace, else lead the lowest loser.
function cashOrDump(hand: Card[], contract: Contract): Card {
  const nonTrumps = hand.filter((c) => !isTrump(c, contract));
  if (nonTrumps.length === 0) return cheapest(hand, contract);
  const ace = nonTrumps.find((c) => c.rank === 'A');
  if (ace) return ace;
  return lowCard(nonTrumps, contract);
}

// Defender on lead. Two ideas drive the choice:
//   - When our partner sits BEHIND the declarer (the declarer plays middlehand,
//     our partner plays last), lead an honour up to them: a king or queen in a
//     side suit whose ace or ten is still out. That forces the declarer to spend
//     a top card or lets our partner win/schmier over them, while we keep our own
//     ace back.
//   - Otherwise cash: lead a side ace, or a ten that has become master (its ace
//     is gone), and never open trumps for the declarer. Failing that, lead low.
function leadAsDefender(s: RoundState, seat: Seat, hand: Card[], contract: Contract): Card {
  const nonTrumps = hand.filter((c) => !isTrump(c, contract));
  if (nonTrumps.length === 0) return cheapest(hand, contract); // only trumps left

  const played = playedCards(s);
  const acePlayed = (suit: Suit) => played.some((c) => c.suit === suit && c.rank === 'A');
  const tenPlayed = (suit: Suit) => played.some((c) => c.suit === suit && c.rank === '10');

  // Push your winners first: cash a side ace, or a ten that has become master
  // (its ace is gone). Banking these points before the declarer can trump them is
  // the bread-and-butter of defence.
  const ace = nonTrumps.find((c) => c.rank === 'A');
  if (ace) return ace;
  const masterTen = nonTrumps.find((c) => c.rank === '10' && acePlayed(c.suit));
  if (masterTen) return masterTen;

  // No winner to cash. If our partner sits BEHIND the declarer (declarer plays
  // middlehand, partner plays last), lead an honour up to them (a king or queen
  // in a side suit whose ace or ten is still live) rather than a dead low card.
  // It pressures the declarer's top cards and lets our partner win or schmier
  // over them. Prefer the king over the queen.
  const partnerBehindDeclarer = s.declarer !== null && s.declarer === ((seat + 1) % 3);
  if (partnerBehindDeclarer) {
    const honours = nonTrumps.filter((c) => (c.rank === 'K' || c.rank === 'Q') && (!acePlayed(c.suit) || !tenPlayed(c.suit)));
    if (honours.length) return honours.sort((a, b) => cardStrength(b, contract) - cardStrength(a, contract))[0];
  }
  return lowCard(nonTrumps, contract);
}

// ---- Small helpers ---------------------------------------------------------

// Every card played to a trick so far this deal (both point piles plus the
// trick in progress). The face-down skat is excluded; a defender can't see it.
function playedCards(s: RoundState): Card[] {
  return [...s.declarerTrickPoints, ...s.defenderTrickPoints, ...s.trick.map((t) => t.card)];
}

// Would playing `card` win the trick as it stands?
function wouldWin(trickCards: Card[], card: Card, contract: Contract): boolean {
  return trickWinner([...trickCards, card], contract) === trickCards.length;
}

// The weakest of a set (lowest trick-strength).
function cheapest(cards: Card[], contract: Contract): Card {
  return [...cards].sort((a, b) => cardStrength(a, contract) - cardStrength(b, contract))[0];
}

// The strongest of a set (highest trick-strength).
function dearest(cards: Card[], contract: Contract): Card {
  return [...cards].sort((a, b) => cardStrength(b, contract) - cardStrength(a, contract))[0];
}

// The card to throw when we don't want the trick: keep trumps and big cards,
// shed a low non-trump first.
function lowCard(cards: Card[], contract: Contract): Card {
  return [...cards].sort(
    (a, b) =>
      Number(isTrump(a, contract)) - Number(isTrump(b, contract)) || // non-trumps first
      cardPoints(a) - cardPoints(b) ||
      cardStrength(a, contract) - cardStrength(b, contract),
  )[0];
}

// The most valuable card to give a partner (schmieren).
function highestPoints(cards: Card[]): Card {
  return [...cards].sort((a, b) => cardPoints(b) - cardPoints(a))[0];
}

// A self-contained strength ranking for ordering our own cards (parallels the
// engine's internal trick-strength: trumps high, jacks highest).
const JACK_RANK: Record<Suit, number> = { C: 4, S: 3, H: 2, D: 1 };
const SIDE_ASC: Card['rank'][] = ['7', '8', '9', 'Q', 'K', '10', 'A'];
const NULL_ASC: Card['rank'][] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function cardStrength(c: Card, contract: Contract): number {
  if (isTrump(c, contract)) {
    if (c.rank === 'J') return 200 + JACK_RANK[c.suit];
    return 100 + SIDE_ASC.indexOf(c.rank);
  }
  if (contract.type === 'null') return NULL_ASC.indexOf(c.rank);
  return SIDE_ASC.indexOf(c.rank);
}
