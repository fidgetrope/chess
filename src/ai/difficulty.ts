import { ChessGame } from '../core/game.ts';
import type { MoveOption } from '../core/types.ts';
import { searchFixedDepth, searchIterativeDeepening } from './minimax.ts';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
  name: string;
  /** 'fixed' searches a set depth; 'iterative' deepens until the time budget runs out. */
  mode: 'fixed' | 'iterative';
  /** Search depth for 'fixed' mode. */
  searchDepth: number;
  /** Time budget in ms for 'iterative' mode. */
  timeBudgetMs: number;
  /**
   * Probability [0,1] that the AI plays the second-best root move instead
   * of the best one, so weaker levels make visible, believable mistakes
   * rather than just playing shallower-but-perfect.
   */
  blunderChance: number;
}

export const DIFFICULTIES: Record<DifficultyLevel, DifficultyConfig> = {
  easy: { name: 'Easy', mode: 'fixed', searchDepth: 2, timeBudgetMs: 0, blunderChance: 0.35 },
  medium: { name: 'Medium', mode: 'fixed', searchDepth: 3, timeBudgetMs: 0, blunderChance: 0.08 },
  hard: { name: 'Hard', mode: 'iterative', searchDepth: 0, timeBudgetMs: 2000, blunderChance: 0 },
};

export interface AiMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
}

/**
 * Chooses the AI's move for the side to move in `fen`. All three levels
 * share the same search and evaluation code; only the config differs.
 * Difficulty affects HOW WELL the AI plays, never whether it obeys the
 * rules — the move always comes from chess.js's legal move list.
 */
export function chooseAiMove(fen: string, config: DifficultyConfig): AiMove | null {
  const game = new ChessGame(fen);
  const legal = game.legalMoves();
  if (legal.length === 0) return null;
  if (legal.length === 1) return toAiMove(legal[0]);

  let chosen: MoveOption | null;

  if (config.blunderChance > 0 && Math.random() < config.blunderChance) {
    chosen = secondBestMove(game, config) ?? bestMove(game, config);
  } else {
    chosen = bestMove(game, config);
  }

  return chosen ? toAiMove(chosen) : toAiMove(legal[0]);
}

function bestMove(game: ChessGame, config: DifficultyConfig): MoveOption | null {
  const result =
    config.mode === 'iterative'
      ? searchIterativeDeepening(game.clone(), config.timeBudgetMs)
      : searchFixedDepth(game.clone(), config.searchDepth);
  return result.move;
}

/**
 * Re-runs a shallow search with the true best move removed, to get a
 * plausible-but-worse alternative. Cheap because it is only ever used at
 * the low difficulty levels (depth <= 3).
 */
function secondBestMove(game: ChessGame, config: DifficultyConfig): MoveOption | null {
  const top = bestMove(game, config);
  if (!top) return null;
  const alternatives = game
    .legalMoves()
    .filter((m) => !(m.from === top.from && m.to === top.to && m.promotion === top.promotion));
  if (alternatives.length === 0) return null;

  const depth = config.mode === 'fixed' ? config.searchDepth : 2;
  let best: MoveOption | null = null;
  let bestScore = -Infinity;
  for (const move of alternatives) {
    const child = game.clone();
    child.move({ from: move.from, to: move.to, promotion: move.promotion });
    // Score from the mover's perspective = negated child-to-move score.
    const score = -searchFixedDepth(child, Math.max(1, depth - 1)).stats.score;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function toAiMove(move: MoveOption): AiMove {
  return { from: move.from, to: move.to, promotion: move.promotion, san: move.san };
}
