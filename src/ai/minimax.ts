import type { ChessGame } from '../core/game.ts';
import type { MoveOption, PieceSymbol } from '../core/types.ts';
import { evaluate } from './evaluate.ts';

/** Score magnitude for a forced mate; the ply offset makes nearer mates preferred. */
const MATE_SCORE = 1_000_000;

const CAPTURE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface SearchStats {
  nodes: number;
  depth: number;
  score: number;
}

export interface SearchOutput {
  move: MoveOption | null;
  stats: SearchStats;
}

/**
 * Move ordering so alpha-beta actually prunes: try the likely-best moves
 * first. Captures (ordered most-valuable-victim / least-valuable-attacker)
 * and promotions come before quiet moves. `preferred`, if given, is the
 * best move from a shallower iteration and is tried first of all.
 */
function orderMoves(moves: MoveOption[], preferred?: MoveOption | null): MoveOption[] {
  const rank = (m: MoveOption): number => {
    let score = 0;
    if (m.isCapture) {
      score += 1000 + CAPTURE_VALUE[m.captured ?? 'p'] * 10 - CAPTURE_VALUE[m.piece];
    }
    if (m.isPromotion) score += 900;
    if (m.isCastle) score += 15;
    if (preferred && m.from === preferred.from && m.to === preferred.to && m.promotion === preferred.promotion) {
      score += 100_000;
    }
    return score;
  };
  return [...moves].sort((a, b) => rank(b) - rank(a));
}

function negamax(
  game: ChessGame,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  deadline: number,
  stats: SearchStats,
): number {
  stats.nodes++;

  if (game.isGameOver()) {
    const outcome = game.outcome();
    if (outcome.type === 'checkmate') {
      // The side to move is mated: as bad as it gets, sooner is worse.
      return -(MATE_SCORE - ply);
    }
    return 0; // any draw
  }

  if (depth === 0) {
    return evaluate(game);
  }

  const moves = orderMoves(game.legalMoves());
  let best = -Infinity;
  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(game, depth - 1, ply + 1, -beta, -alpha, deadline, stats);
    game.undo();

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // cutoff
    if (Date.now() >= deadline) break; // out of time; caller discards this depth
  }
  return best;
}

/** One fixed-depth search from the root. `aborted` means the time budget ran out mid-search. */
function searchAtDepth(
  game: ChessGame,
  depth: number,
  deadline: number,
  preferred: MoveOption | null,
  stats: SearchStats,
): { move: MoveOption | null; score: number; aborted: boolean } {
  const moves = orderMoves(game.legalMoves(), preferred);
  let bestMove: MoveOption | null = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  let aborted = false;

  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(game, depth - 1, 1, -beta, -alpha, deadline, stats);
    game.undo();

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (bestScore > alpha) alpha = bestScore;

    if (Date.now() >= deadline) {
      aborted = true;
      break;
    }
  }

  return { move: bestMove, score: bestScore, aborted };
}

/** Plain fixed-depth alpha-beta search. Used by Easy / Medium. */
export function searchFixedDepth(game: ChessGame, depth: number): SearchOutput {
  const stats: SearchStats = { nodes: 0, depth, score: 0 };
  const result = searchAtDepth(game, depth, Number.POSITIVE_INFINITY, null, stats);
  stats.score = result.score;
  return { move: result.move, stats };
}

/**
 * Iterative deepening within a time budget: search depth 1, then 2, then 3,
 * and so on until the clock runs out, always keeping the best move from the
 * last fully-completed depth. Keeps "Hard" responsive on any machine
 * instead of hanging on a fixed deep search.
 */
export function searchIterativeDeepening(
  game: ChessGame,
  timeBudgetMs: number,
  maxDepth = 64,
): SearchOutput {
  const deadline = Date.now() + timeBudgetMs;
  const stats: SearchStats = { nodes: 0, depth: 0, score: 0 };

  let best: MoveOption | null = null;
  let bestScore = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const result = searchAtDepth(game, depth, deadline, best, stats);

    if (!result.aborted && result.move) {
      best = result.move;
      bestScore = result.score;
      stats.depth = depth;
      stats.score = bestScore;
      // A forced mate has been found; no deeper search will beat it.
      if (Math.abs(bestScore) > MATE_SCORE - 1000) break;
    }

    if (Date.now() >= deadline) break;
  }

  // Nothing completed even depth 1 (extremely tight budget): fall back to
  // the ordered first legal move so the AI always plays something legal.
  if (!best) {
    const moves = orderMoves(game.legalMoves());
    best = moves[0] ?? null;
  }

  return { move: best, stats };
}
