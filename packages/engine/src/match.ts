// A match strings many rounds together and decides when play is over.
// Three physical players (0,1,2) keep a running score. Each deal rotates who
// sits forehand/middlehand/rearhand.
//
// Formats requested:
//   - fixed deal counts: 6, 12, or 36 deals
//   - score race: first to 250, or first to 1000
// In every format the match may only end on a complete dealing cycle, i.e.
// when (deals played) % 3 === 0, so each player has dealt an equal number of
// times.

import type { Seat } from './types.ts';
import { sessionDelta, type GameValueResult } from './scoring.ts';

export type MatchFormat =
  | { kind: 'deals'; deals: 3 | 6 | 12 | 36 } // 3 = a single dealing cycle, used for practice
  | { kind: 'race'; target: 250 | 1000 };

export interface MatchState {
  format: MatchFormat;
  scores: [number, number, number]; // indexed by physical player
  dealsPlayed: number;
  finished: boolean;
  winner: number | null; // physical player, or null until finished
}

export function createMatch(format: MatchFormat): MatchState {
  return { format, scores: [0, 0, 0], dealsPlayed: 0, finished: false, winner: null };
}

// Maps a within-round seat role to the physical player for a given deal.
// Forehand (seat 0) at deal d is player d % 3; roles rotate with the deal.
export function seatToPlayer(dealIndex: number, seat: Seat): number {
  return (dealIndex + seat) % 3;
}

// Records the outcome of one round and advances the match. Pass the deal index
// (0-based), the declarer's seat role, and the round result — or null for a
// passed-in deal (no game played, no score change).
export function recordRound(
  match: MatchState,
  dealIndex: number,
  declarerSeat: Seat | null,
  result: GameValueResult | null,
): MatchState {
  if (match.finished) throw new Error('match is already finished');
  const m: MatchState = { ...match, scores: [...match.scores] as [number, number, number] };

  if (result && declarerSeat !== null) {
    const player = seatToPlayer(dealIndex, declarerSeat);
    m.scores[player] += sessionDelta(result);
  }
  m.dealsPlayed += 1;

  // The match can only conclude after a full dealing cycle.
  if (m.dealsPlayed % 3 === 0) {
    if (m.format.kind === 'deals' && m.dealsPlayed >= m.format.deals) {
      finish(m);
    } else if (m.format.kind === 'race' && Math.max(...m.scores) >= m.format.target) {
      finish(m);
    }
  }
  return m;
}

function finish(m: MatchState): void {
  m.finished = true;
  const best = Math.max(...m.scores);
  m.winner = m.scores.indexOf(best);
}
