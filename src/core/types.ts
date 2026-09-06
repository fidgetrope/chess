// Core chess types. This module has zero rendering/DOM dependencies and no
// dependency on chess.js itself, so both the wrapper (core/game.ts) and the
// AI can share a single vocabulary that stays trivially unit-testable.

export type Color = 'white' | 'black';

/** Which board presentation is on screen. */
export type ViewMode = '3d' | '2d';

/** Standard piece letters, matching chess.js: p n b r q k. */
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** Algebraic square name, e.g. 'e4'. */
export type SquareName = string;

export interface Piece {
  color: Color;
  type: PieceSymbol;
}

/**
 * A board square addressed by grid position. row 0 is rank 1 (White's back
 * rank), row 7 is rank 8; col 0 is file 'a', col 7 is file 'h'. The render
 * layer works in these; the rules layer works in SquareName. `squareName`
 * / `squareToGrid` in core/game.ts convert between them.
 */
export interface Square {
  row: number; // 0-7
  col: number; // 0-7
}

/**
 * One legal move offered to a player. `promotion` is only set for pawn
 * moves that reach the last rank; the UI presents a picker and fills it in.
 * `san` is the human-readable notation ("Nf3", "exd5", "O-O", "e8=Q+").
 */
export interface MoveOption {
  from: SquareName;
  to: SquareName;
  promotion?: PieceSymbol;
  san: string;
  /** Piece being moved. */
  piece: PieceSymbol;
  /** Piece captured, if any (includes en-passant captures). */
  captured?: PieceSymbol;
  isCapture: boolean;
  isPromotion: boolean;
  isCastle: boolean;
  isEnPassant: boolean;
}

export type DrawReason =
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  | 'agreed';

export type GameOutcome =
  | { type: 'in-progress' }
  | { type: 'checkmate'; winner: Color }
  | { type: 'draw'; reason: DrawReason };
