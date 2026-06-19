import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Contract } from '../src/types.ts';
import { trickWinner, isTrump, trumpsHighToLow } from '../src/ordering.ts';
import { freshDeck, totalPoints } from '../src/cards.ts';

const c = (s: string): Card => ({ suit: s[0] as any, rank: s.slice(1) as any });

test('deck has 32 cards worth 120 points', () => {
  const deck = freshDeck();
  assert.equal(deck.length, 32);
  assert.equal(totalPoints(deck), 120);
});

test('jacks are trump in a suit game and ordered C>S>H>D', () => {
  const hearts: Contract = { type: 'suit', suit: 'H' };
  assert.ok(isTrump(c('CJ'), hearts));
  assert.ok(isTrump(c('DJ'), hearts));
  // Club Jack (highest) beats Diamond Jack regardless of play order.
  assert.equal(trickWinner([c('DJ'), c('CJ')], hearts), 1);
  assert.equal(trickWinner([c('CJ'), c('DJ')], hearts), 0);
});

test('trump suit beats a led side suit', () => {
  const hearts: Contract = { type: 'suit', suit: 'H' };
  // Ace of spades led, low heart trumps it.
  assert.equal(trickWinner([c('SA'), c('H7')], hearts), 1);
});

test('within a led side suit, A 10 K Q rank correctly', () => {
  const hearts: Contract = { type: 'suit', suit: 'H' };
  // 10 beats King, both spades; no trump played.
  assert.equal(trickWinner([c('SK'), c('S10')], hearts), 1);
  // Ace beats 10.
  assert.equal(trickWinner([c('S10'), c('SA')], hearts), 1);
  // Off-suit discard cannot win.
  assert.equal(trickWinner([c('SK'), c('D7')], hearts), 0);
});

test('grand: only jacks are trump', () => {
  const grand: Contract = { type: 'grand' };
  assert.ok(isTrump(c('CJ'), grand));
  assert.ok(!isTrump(c('CA'), grand));
  assert.equal(trumpsHighToLow(grand).length, 4);
  // A jack trumps a led ace.
  assert.equal(trickWinner([c('CA'), c('DJ')], grand), 1);
});

test('null: no trumps and J sits between 10 and Q', () => {
  const nul: Contract = { type: 'null' };
  assert.ok(!isTrump(c('CJ'), nul));
  // In null, King beats Jack of the same suit (A K Q J 10..).
  assert.equal(trickWinner([c('SJ'), c('SK')], nul), 1);
  // Queen beats Jack.
  assert.equal(trickWinner([c('SJ'), c('SQ')], nul), 1);
  // Jack beats 10.
  assert.equal(trickWinner([c('S10'), c('SJ')], nul), 1);
  // A jack does NOT trump a led ace of another suit.
  assert.equal(trickWinner([c('HA'), c('SJ')], nul), 0);
});

test('suit game trump order: A 10 K Q J... J is highest trump', () => {
  const clubs: Contract = { type: 'suit', suit: 'C' };
  const order = trumpsHighToLow(clubs).map((x) => x.suit + x.rank);
  assert.equal(order[0], 'CJ');
  assert.equal(order[4], 'CA'); // highest non-jack trump
  assert.equal(order[order.length - 1], 'C7');
  assert.equal(order.length, 11); // 4 jacks + 7 club cards
});
