import type { ChessGame } from '../core/game.ts';
import type { MoveOption, PieceSymbol } from '../core/types.ts';
import { evaluate } from './evaluate.ts';

/** Score magnitude for a forced mate; the ply offset makes nearer mates preferred. */
export const MATE_SCORE = 1_000_000;

/** True if a centipawn score represents a forced mate for one side or the other. */
export function isMateScore(cp: number): boolean {
  return Math.abs(cp) > MATE_SCORE - 1000;
}

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

/**
 * One fixed-depth search from the root. `aborted` means the time budget
 * ran out mid-search. `rootNoise`, if set, adds a random centipawn jitter
 * to each root move's score *for selection only* — pruning and the
 * returned score stay honest — so a weaker level plays a bit loosely
 * without ever missing that a move hangs a whole piece.
 */
function searchAtDepth(
  game: ChessGame,
  depth: number,
  deadline: number,
  preferred: MoveOption | null,
  stats: SearchStats,
  rootNoise: number,
): { move: MoveOption | null; score: number; aborted: boolean } {
  const moves = orderMoves(game.legalMoves(), preferred);
  let bestMove: MoveOption | null = null;
  let bestScore = -Infinity; // true score of the chosen move (for the caller)
  let bestPick = -Infinity; // jittered score used only to pick
  let alpha = -Infinity; // best true score seen, for correct pruning
  const beta = Infinity;
  let aborted = false;

  for (const move of moves) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(game, depth - 1, 1, -beta, -alpha, deadline, stats);
    game.undo();

    // Jitter quiet scores only; a forced mate (for or against) is never
    // fudged, so the AI still takes the fastest mate and never walks into one.
    const decisive = Math.abs(score) > MATE_SCORE - 1000;
    const pick = rootNoise > 0 && !decisive ? score + (Math.random() * 2 - 1) * rootNoise : score;
    if (pick > bestPick) {
      bestPick = pick;
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;

    if (Date.now() >= deadline) {
      aborted = true;
      break;
    }
  }

  return { move: bestMove, score: bestScore, aborted };
}

/** Plain fixed-depth alpha-beta search. Used by Easy / Medium. */
export function searchFixedDepth(game: ChessGame, depth: number, rootNoise = 0): SearchOutput {
  const stats: SearchStats = { nodes: 0, depth, score: 0 };
  const result = searchAtDepth(game, depth, Number.POSITIVE_INFINITY, null, stats, rootNoise);
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
  rootNoise = 0,
  maxDepth = 64,
): SearchOutput {
  const deadline = Date.now() + timeBudgetMs;
  const stats: SearchStats = { nodes: 0, depth: 0, score: 0 };

  let best: MoveOption | null = null;
  let bestScore = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const result = searchAtDepth(game, depth, deadline, best, stats, rootNoise);

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

// ---------------------------------------------------------------------------
// Analysis — used by the coach, not by the opponent. Always full strength
// regardless of difficulty, and it ranks the strongest candidate moves so
// the coach can compare the player's choice against the best.
// ---------------------------------------------------------------------------

export interface RootMoveScore {
  move: MoveOption;
  /** Score from the analysing side's point of view; positive is good for them. */
  scoreCp: number;
}

export interface Analysis {
  /** The position's eval from the side to move's point of view. */
  scoreCp: number;
  /** The strongest candidate moves, best first (not every legal move). */
  moves: RootMoveScore[];
  /** Deepest ply fully searched. */
  depth: number;
}

function sameMove(a: MoveOption, b: MoveOption): boolean {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

/** True score of one specific move (full window, no time limit). */
export function scoreMove(
  game: ChessGame,
  move: { from: string; to: string; promotion?: PieceSymbol },
  depth: number,
): number {
  const stats: SearchStats = { nodes: 0, depth, score: 0 };
  game.move(move);
  const score = -negamax(game, depth - 1, 1, -Infinity, Infinity, Number.POSITIVE_INFINITY, stats);
  game.undo();
  return score;
}

/**
 * A fast pruned search for the honest best move and eval, then a full-window
 * re-score of just the strongest handful of candidates so they can be
 * ranked for the coach panel. `timeBudgetMs` caps wall time for the phone.
 */
export function analyzePosition(
  game: ChessGame,
  opts: { maxDepth?: number; timeBudgetMs?: number } = {},
): Analysis {
  const maxDepth = opts.maxDepth ?? 5;
  const budget = opts.timeBudgetMs ?? 1200;
  const deadline = Date.now() + budget;

  // 1. Pruned iterative-deepening search: honest best move + eval + depth reached.
  const pruned = searchIterativeDeepening(game.clone(), Math.round(budget * 0.55), 0, maxDepth);
  const evalCp = pruned.stats.score;
  const bestMove = pruned.move;
  const depth = Math.max(1, pruned.stats.depth);

  // 2. Re-score the strongest candidates at that depth, full window.
  const stats: SearchStats = { nodes: 0, depth, score: 0 };
  const candidates = orderMoves(game.legalMoves(), bestMove).slice(0, 6);
  const scored: RootMoveScore[] = [];
  for (const move of candidates) {
    if (Date.now() >= deadline) break;
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const scoreCp = -negamax(game, depth - 1, 1, -Infinity, Infinity, deadline, stats);
    game.undo();
    scored.push({ move, scoreCp });
  }
  scored.sort((a, b) => b.scoreCp - a.scoreCp);

  // Guarantee the pruned best move is present even if the deadline cut it off.
  if (bestMove && !scored.some((s) => sameMove(s.move, bestMove))) {
    scored.unshift({ move: bestMove, scoreCp: evalCp });
  }

  return { scoreCp: scored[0]?.scoreCp ?? evalCp, moves: scored, depth };
}
