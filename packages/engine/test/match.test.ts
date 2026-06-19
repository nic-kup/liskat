import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, recordRound, seatToPlayer } from '../src/match.ts';
import type { GameValueResult } from '../src/scoring.ts';

const won = (value: number): GameValueResult => ({ won: true, value, multiplier: 1, schneider: false, schwarz: false });
const lost = (value: number): GameValueResult => ({ won: false, value, multiplier: 1, schneider: false, schwarz: false });

test('roles rotate with the deal', () => {
  assert.equal(seatToPlayer(0, 0), 0);
  assert.equal(seatToPlayer(1, 0), 1);
  assert.equal(seatToPlayer(2, 0), 2);
  assert.equal(seatToPlayer(3, 0), 0); // wraps after a full cycle
});

test('a won game adds its value to the declarer; a loss subtracts double', () => {
  let m = createMatch({ kind: 'deals', deals: 6 });
  m = recordRound(m, 0, 0, won(24)); // player 0 wins 24
  assert.equal(m.scores[0], 24);
  m = recordRound(m, 1, 0, lost(20)); // deal 1, declarer seat 0 -> player 1, loses 2*20
  assert.equal(m.scores[1], -40);
});

test('a passed-in deal still counts toward the cycle but changes no score', () => {
  let m = createMatch({ kind: 'deals', deals: 6 });
  m = recordRound(m, 0, null, null);
  assert.deepEqual(m.scores, [0, 0, 0]);
  assert.equal(m.dealsPlayed, 1);
});

test('a 6-deal match ends exactly after six deals', () => {
  let m = createMatch({ kind: 'deals', deals: 6 });
  for (let d = 0; d < 5; d++) m = recordRound(m, d, 0, won(18));
  assert.ok(!m.finished);
  m = recordRound(m, 5, 0, won(18));
  assert.ok(m.finished);
  assert.equal(m.winner, seatToPlayer(0, 0)); // player 0 declared and won several
});

test('a race only ends on a complete dealing cycle, even past the target', () => {
  let m = createMatch({ kind: 'race', target: 250 });
  // Player 0 blows past 250 on deal index 0 (not a cycle boundary).
  m = recordRound(m, 0, 0, won(300));
  assert.ok(!m.finished, 'cannot end mid-cycle');
  m = recordRound(m, 1, 1, won(10)); // seat 0 at deal 1 -> player 1
  assert.ok(!m.finished);
  m = recordRound(m, 2, 1, won(10)); // deal index 2 -> dealsPlayed becomes 3, cycle complete
  assert.ok(m.finished);
  assert.equal(m.winner, 0);
});
