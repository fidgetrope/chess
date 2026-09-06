import { ChessGame } from '../core/game.ts';
import type { MoveOption } from '../core/types.ts';
import { analyzePosition, isMateScore, MATE_SCORE, type Analysis } from './minimax.ts';

// The coach's analysis. Runs at full strength regardless of the opponent's
// difficulty, and — unlike the playing search — scores every legal move so
// the player's choice can be ranked against the best.

const PANEL_ANALYSIS = { maxDepth: 4, timeBudgetMs: 1200 };
const THREAT_ANALYSIS = { maxDepth: 3, timeBudgetMs: 700 };

export interface Threat {
  move: MoveOption;
  /** Centipawn swing the opponent gains by us doing nothing; MATE_SCORE if it's mate. */
  gainCp: number;
  isMate: boolean;
}

export interface CoachReport {
  analysis: Analysis;
  threat: Threat | null;
}

/**
 * What can the opponent do if we pass? Null-move, analyse for them, and
 * flag it if their best reply is a forced mate or swings the evaluation
 * clearly in their favour compared with us playing a sensible move.
 * `ourBestCp` is this position's eval with best play, from our point of view.
 */
export function findThreat(game: ChessGame, ourBestCp: number): Threat | null {
  // If we already have a forced mate or a decisive material edge there's
  // nothing useful to warn about — just play the good move.
  if (isMateScore(ourBestCp) || ourBestCp > 450) return null;

  return game.withNullMove(() => {
    const after = analyzePosition(game, THREAT_ANALYSIS);
    const oppBest = after.moves[0];
    if (!oppBest) return null;

    if (isMateScore(oppBest.scoreCp) && oppBest.scoreCp > 0) {
      return { move: oppBest.move, gainCp: MATE_SCORE, isMate: true };
    }

    // Swing = how much better the opponent ends up if we pass (they reach
    // `oppBest`) versus us playing our best (they reach `-ourBestCp`).
    const swing = oppBest.scoreCp + ourBestCp;
    if (swing > 150 && oppBest.scoreCp > -30) {
      return { move: oppBest.move, gainCp: swing, isMate: false };
    }
    return null;
  });
}

export function coachAnalyse(fen: string): CoachReport {
  const game = new ChessGame(fen);
  const analysis = analyzePosition(game, PANEL_ANALYSIS);
  const threat = findThreat(game, analysis.scoreCp);
  return { analysis, threat };
}
