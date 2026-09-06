/// <reference lib="webworker" />
import { ChessGame } from '../core/game.ts';
import type { Color, PieceSymbol } from '../core/types.ts';
import { coachAnalyse } from './coach.ts';
import { standingWords } from './evalWords.ts';
import { analyzePosition, scoreMove } from './minimax.ts';
import { reasonFor } from './moveReason.ts';

type MoveRef = { from: string; to: string; promotion?: PieceSymbol };

export interface CoachRequest {
  requestId: number;
  fen: string;
  /** The player being coached (always White in this game, but passed for clarity). */
  humanColor: Color;
  /** 'panel' = full advice for the coach panel; 'blunderCheck' = is `move` much worse than best? */
  mode: 'panel' | 'blunderCheck';
  move?: MoveRef;
}

export interface CoachResponse {
  requestId: number;
  mode: 'panel' | 'blunderCheck';
  hint: { san: string; from: string; to: string; promotion?: string; reason: string } | null;
  threat: { san: string; from: string; to: string; text: string } | null;
  standing: string | null;
  /** Present only for a 'blunderCheck'. `null` there means "not a blunder". */
  blunder: { dropCp: number; bestSan: string } | null;
}

/**
 * The coach's full-strength analysis, off the main thread and separate from
 * the opponent's worker so a ~1 s analysis on the player's turn never
 * delays the opponent's reply.
 */
self.onmessage = (event: MessageEvent<CoachRequest>) => {
  const { requestId, fen, humanColor, mode, move } = event.data;

  if (mode === 'blunderCheck' && move) {
    const analysis = analyzePosition(new ChessGame(fen), { maxDepth: 4, timeBudgetMs: 650 });
    const best = analysis.moves[0];
    let blunder: CoachResponse['blunder'] = null;
    if (best) {
      const chosenCp = scoreMove(new ChessGame(fen), move, analysis.depth);
      const dropCp = best.scoreCp - chosenCp;
      if (dropCp > 150) blunder = { dropCp, bestSan: best.move.san };
    }
    const reply: CoachResponse = {
      requestId,
      mode,
      hint: null,
      threat: null,
      standing: null,
      blunder,
    };
    self.postMessage(reply);
    return;
  }

  const { analysis, threat } = coachAnalyse(fen);
  const best = analysis.moves[0];

  const hint = best
    ? {
        san: best.move.san,
        from: best.move.from,
        to: best.move.to,
        promotion: best.move.promotion,
        reason: reasonFor(best.move, humanColor),
      }
    : null;

  let threatOut: CoachResponse['threat'] = null;
  if (threat) {
    threatOut = {
      san: threat.move.san,
      from: threat.move.from,
      to: threat.move.to,
      text: threat.isMate
        ? `Watch out — the AI is threatening ${threat.move.san}, checkmate.`
        : `Watch out — the AI is threatening ${threat.move.san}, winning ${
            threat.gainCp >= 450 ? 'a piece or more' : 'a pawn or two'
          }.`,
    };
  }

  const reply: CoachResponse = {
    requestId,
    mode,
    hint,
    threat: threatOut,
    standing: standingWords(analysis.scoreCp),
    blunder: null,
  };
  self.postMessage(reply);
};
