import { Chess, type Square as ChessSquare } from 'chess.js';
import type {
  Color,
  GameOutcome,
  MoveOption,
  Piece,
  PieceSymbol,
  Square,
  SquareName,
} from './types.ts';

const FILES = 'abcdefgh';

/** Grid position -> algebraic name. row 0 = rank 1, col 0 = file 'a'. */
export function squareName(square: Square): SquareName {
  return `${FILES[square.col]}${square.row + 1}`;
}

/** Algebraic name -> grid position. */
export function squareToGrid(name: SquareName): Square {
  return { col: FILES.indexOf(name[0]), row: Number(name[1]) - 1 };
}

export function squaresEqual(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

export function opponentOf(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

function toColor(c: 'w' | 'b'): Color {
  return c === 'w' ? 'white' : 'black';
}

interface VerboseMove {
  from: SquareName;
  to: SquareName;
  piece: PieceSymbol;
  color: 'w' | 'b';
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: string;
  san: string;
}

function describeMove(m: VerboseMove): MoveOption {
  const isEnPassant = m.flags.includes('e');
  return {
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    san: m.san,
    piece: m.piece,
    captured: m.captured,
    isCapture: m.flags.includes('c') || isEnPassant,
    isPromotion: m.flags.includes('p'),
    isCastle: m.flags.includes('k') || m.flags.includes('q'),
    isEnPassant,
  };
}

/**
 * Thin wrapper around chess.js. The rest of the app talks to this class
 * rather than the library directly, so the rules engine could be swapped
 * later (for Stockfish.js, say) without touching render, AI, or UI code.
 *
 * chess.js owns all the hard parts: castling rights, en passant, promotion,
 * threefold repetition, the fifty-move rule and insufficient-material
 * draws. Move history and undo come for free from its `history()` /
 * `undo()`.
 */
export class ChessGame {
  private chess: Chess;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  get turn(): Color {
    return toColor(this.chess.turn());
  }

  fen(): string {
    return this.chess.fen();
  }

  /** 8x8 grid, `board[row][col]`, row 0 = rank 1. `null` where empty. */
  board(): (Piece | null)[][] {
    const raw = this.chess.board(); // raw[0] is rank 8
    const grid: (Piece | null)[][] = [];
    for (let row = 0; row < 8; row++) {
      const rankRow = raw[7 - row];
      grid.push(
        rankRow.map((cell) =>
          cell ? { color: toColor(cell.color), type: cell.type as PieceSymbol } : null,
        ),
      );
    }
    return grid;
  }

  pieceAt(square: Square): Piece | null {
    const cell = this.chess.get(squareName(square) as ChessSquare);
    if (!cell) return null;
    return { color: toColor(cell.color), type: cell.type as PieceSymbol };
  }

  legalMoves(): MoveOption[] {
    return (this.chess.moves({ verbose: true }) as unknown as VerboseMove[]).map(describeMove);
  }

  legalMovesFrom(square: Square): MoveOption[] {
    return (
      this.chess.moves({
        square: squareName(square) as ChessSquare,
        verbose: true,
      }) as unknown as VerboseMove[]
    ).map(describeMove);
  }

  /**
   * Applies a move. Throws if it is illegal. `promotion` defaults to queen
   * inside chess.js when omitted for a promoting pawn move, but callers
   * should pass it explicitly (the UI collects it from a picker).
   */
  move(move: { from: SquareName; to: SquareName; promotion?: PieceSymbol }): MoveOption {
    const applied = this.chess.move(move) as unknown as VerboseMove;
    return describeMove(applied);
  }

  /** Undoes the last ply. Returns the undone move, or null if none. */
  undo(): MoveOption | null {
    const undone = this.chess.undo() as unknown as VerboseMove | null;
    return undone ? describeMove(undone) : null;
  }

  inCheck(): boolean {
    return this.chess.isCheck();
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  /** SAN move list, one entry per ply. */
  history(): string[] {
    return this.chess.history();
  }

  /** Full detail for every ply played so far, oldest first. */
  detailedHistory(): MoveOption[] {
    return (this.chess.history({ verbose: true }) as unknown as VerboseMove[]).map(describeMove);
  }

  plyCount(): number {
    return this.chess.history().length;
  }

  /** The square of the side-to-move's king, for check highlighting. */
  kingSquare(color: Color): Square | null {
    const board = this.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece && piece.type === 'k' && piece.color === color) return { row, col };
      }
    }
    return null;
  }

  outcome(): GameOutcome {
    if (this.chess.isCheckmate()) {
      // Side to move has been mated, so the other side won.
      return { type: 'checkmate', winner: opponentOf(this.turn) };
    }
    if (this.chess.isStalemate()) {
      return { type: 'draw', reason: 'stalemate' };
    }
    if (this.chess.isInsufficientMaterial()) {
      return { type: 'draw', reason: 'insufficient-material' };
    }
    if (this.chess.isThreefoldRepetition()) {
      return { type: 'draw', reason: 'threefold-repetition' };
    }
    if (this.chess.isDraw()) {
      // isDraw() is also true for the two cases above; reaching here means
      // it's the remaining one chess.js folds into isDraw(): 50-move rule.
      return { type: 'draw', reason: 'fifty-move-rule' };
    }
    return { type: 'in-progress' };
  }

  clone(): ChessGame {
    return new ChessGame(this.fen());
  }
}
