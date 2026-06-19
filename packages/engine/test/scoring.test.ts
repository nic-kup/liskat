import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Contract } from '../src/types.ts';
import type { Announcements } from '../src/scoring.ts';
import { countMatadors, computeGameValue } from '../src/scoring.ts';

const c = (s: string): Card => ({ suit: s[0] as any, rank: s.slice(1) as any });
const noAnn: Announcements = {
  hand: false,
  schneiderAnnounced: false,
  schwarzAnnounced: false,
  ouvert: false,
};

test('matadors "with 2": holds CJ and SJ but not HJ', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const hand = [c('CJ'), c('SJ'), c('CA'), c('C7')];
  // top trump CJ held, next SJ held, HJ missing -> with 2
  assert.equal(countMatadors(hand, clubs), 2);
});

test('matadors "without 1": missing CJ but holds SJ', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const hand = [c('SJ'), c('CA'), c('C10')];
  // top trump CJ NOT held -> count missing run from top: just CJ -> without 1
  assert.equal(countMatadors(hand, clubs), 1);
});

test('clubs with 2: value = 12 * (2 + 1 game) = 36, won', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const declarerCards = [c('CJ'), c('SJ'), c('CA'), c('C10'), c('CK')];
  const r = computeGameValue(
    clubs,
    declarerCards,
    { declarerCardPoints: 75, defenderTricks: 4 },
    noAnn,
    18,
  );
  assert.equal(r.multiplier, 3);
  assert.equal(r.value, 36);
  assert.ok(r.won);
});

test('schneider adds a multiplier and is detected at 90+', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const declarerCards = [c('CJ'), c('SJ')];
  const r = computeGameValue(
    clubs,
    declarerCards,
    { declarerCardPoints: 95, defenderTricks: 2 },
    noAnn,
    18,
  );
  assert.ok(r.schneider);
  // 12 * (2 matadors + 1 game + 1 schneider) = 48
  assert.equal(r.value, 48);
  assert.ok(r.won);
});

test('failing to reach 61 loses the game', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const declarerCards = [c('CJ'), c('SJ')];
  const r = computeGameValue(
    clubs,
    declarerCards,
    { declarerCardPoints: 59, defenderTricks: 5 },
    noAnn,
    18,
  );
  assert.ok(!r.won);
});

test('overbid: game value below the bid loses even at 61+', () => {
  const diamonds: Contract = { type: 'suit', suit: 'D' };
  const declarerCards = [c('SJ')]; // missing CJ, holds SJ => without 1
  // diamonds base 9, without 1 => 9 * (1 + 1 game) = 18, but bid 24 -> overbid
  const r = computeGameValue(
    diamonds,
    declarerCards,
    { declarerCardPoints: 80, defenderTricks: 3 },
    noAnn,
    24,
  );
  assert.equal(r.value, 18);
  assert.ok(!r.won);
});

test('null is a fixed value and won only by losing every trick', () => {
  const nul: Contract = { type: 'null' };
  const win = computeGameValue(nul, [], { declarerCardPoints: 0, defenderTricks: 10, declarerWonATrick: false }, noAnn, 18);
  assert.equal(win.value, 23);
  assert.ok(win.won);

  const loss = computeGameValue(nul, [], { declarerCardPoints: 0, defenderTricks: 9, declarerWonATrick: true }, noAnn, 18);
  assert.ok(!loss.won);
});

test('null ouvert hand has value 59', () => {
  const nul: Contract = { type: 'null' };
  const r = computeGameValue(
    nul,
    [],
    { declarerCardPoints: 0, defenderTricks: 10, declarerWonATrick: false },
    { ...noAnn, hand: true, ouvert: true },
    18,
  );
  assert.equal(r.value, 59);
});
