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

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

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

  // ---------------------------------------------------------------------------
  // Rules helper: plain-language reason a move the player tried isn't legal.
  // Used by the "explain moves I can't make" aid — pure rules, no engine.
  // ---------------------------------------------------------------------------

  /**
   * A one-sentence explanation of why moving the piece on `from` to `to`
   * isn't allowed, or `null` if the move is in fact legal. `from` is
   * assumed to hold a piece of the side to move.
   */
  explainIllegalMove(from: SquareName, to: SquareName): string | null {
    if (from === to) return null;
    const mover = this.chess.get(from as ChessSquare);
    if (!mover) return null;
    if (this.legalMovesFrom(squareToGrid(from)).some((m) => m.to === to)) return null;

    const ff = FILES.indexOf(from[0]);
    const fr = Number(from[1]) - 1;
    const tf = FILES.indexOf(to[0]);
    const tr = Number(to[1]) - 1;
    const df = tf - ff;
    const dr = tr - fr;
    const adf = Math.abs(df);
    const adr = Math.abs(dr);

    // A castling-shaped king move: explain castling even though a rook or
    // knight may be sitting on the target square.
    if (mover.type === 'k' && adr === 0 && adf === 2) {
      return this.castlingProblem(mover.color, df > 0 ? 'k' : 'q');
    }

    const target = this.chess.get(to as ChessSquare);
    if (target && target.color === mover.color) {
      return `That's your own ${PIECE_NAMES[target.type as PieceSymbol]} — you can't capture your own pieces.`;
    }
    const blocked = (): string | null => {
      const b = this.firstBlocker(from, to);
      return b ? `The ${PIECE_NAMES[b.type]} on ${b.square} is in the way.` : null;
    };

    switch (mover.type) {
      case 'p': {
        const dir = mover.color === 'w' ? 1 : -1;
        const startRank = mover.color === 'w' ? 1 : 6;
        if (df === 0 && dr === dir) {
          if (target) return `A pawn can't capture straight ahead — pawns only capture diagonally.`;
          break;
        }
        if (df === 0 && dr === 2 * dir) {
          if (fr !== startRank) return `A pawn can only move two squares from its starting square.`;
          if (target || this.chess.get(`${from[0]}${fr + dir + 1}` as ChessSquare)) {
            return `A pawn can't move forward onto or over another piece.`;
          }
          break;
        }
        if (adf === 1 && dr === dir) {
          if (target) break;
          return `A pawn moves diagonally only to capture, and there's nothing to take on ${to}.`;
        }
        if (df === 0 && Math.sign(dr) === dir) {
          return `A pawn moves one square forward — or two from its starting square.`;
        }
        if (Math.sign(dr) === -dir) return `Pawns can't move backwards.`;
        return `Pawns move straight forward and capture one square diagonally — not like that.`;
      }
      case 'n': {
        if (!((adf === 1 && adr === 2) || (adf === 2 && adr === 1))) {
          return `A knight moves in an L — two squares one way, then one square across.`;
        }
        break;
      }
      case 'b': {
        if (adf !== adr) return `A bishop moves only along diagonals.`;
        const b = blocked();
        if (b) return b;
        break;
      }
      case 'r': {
        if (df !== 0 && dr !== 0) return `A rook moves only in straight lines, along a rank or a file.`;
        const b = blocked();
        if (b) return b;
        break;
      }
      case 'q': {
        if (df !== 0 && dr !== 0 && adf !== adr) {
          return `A queen moves in straight lines or along diagonals — not in that shape.`;
        }
        const b = blocked();
        if (b) return b;
        break;
      }
      case 'k': {
        // Castling shape is handled before the switch; only ordinary steps reach here.
        if (adf > 1 || adr > 1) return `The king moves one square at a time (except when castling).`;
        return this.kingStepProblem(mover.color, from, to);
      }
    }

    // The piece could reach the square if the board were otherwise empty of
    // concerns — so the move is illegal only because of the king.
    if (this.chess.isCheck()) {
      return `Your king is in check — you have to get out of check, and this move doesn't.`;
    }
    const pinner = this.findPinner(from, mover.color);
    if (pinner) {
      return `That ${PIECE_NAMES[mover.type as PieceSymbol]} is pinned — moving it would expose your king to the ${PIECE_NAMES[pinner.type]} on ${pinner.square}.`;
    }
    return `That move would put your own king in check.`;
  }

  /**
   * Why the piece on `from` has no legal move at all, when there's a rule
   * worth stating (in check, or pinned). `null` when it's just hemmed in.
   */
  explainNoMoves(from: SquareName): string | null {
    const mover = this.chess.get(from as ChessSquare);
    if (!mover) return null;
    if (this.legalMovesFrom(squareToGrid(from)).length > 0) return null;

    if (this.chess.isCheck()) {
      if (mover.type === 'k') {
        return `Your king is in check and every square it could step to is also attacked.`;
      }
      return `Your king is in check — only a move that gets out of check is allowed, and this ${PIECE_NAMES[mover.type as PieceSymbol]} can't make one.`;
    }
    if (mover.type !== 'k') {
      const pinner = this.findPinner(from, mover.color);
      if (pinner) {
        return `That ${PIECE_NAMES[mover.type as PieceSymbol]} is pinned by the ${PIECE_NAMES[pinner.type]} on ${pinner.square} — moving it would leave your king in check.`;
      }
    }
    return null;
  }

  /** First piece strictly between two aligned squares, or null. */
  private firstBlocker(
    from: SquareName,
    to: SquareName,
  ): { type: PieceSymbol; square: SquareName } | null {
    const ff = FILES.indexOf(from[0]);
    const fr = Number(from[1]) - 1;
    const tf = FILES.indexOf(to[0]);
    const tr = Number(to[1]) - 1;
    const stepF = Math.sign(tf - ff);
    const stepR = Math.sign(tr - fr);
    let f = ff + stepF;
    let r = fr + stepR;
    while (f !== tf || r !== tr) {
      const sq = `${FILES[f]}${r + 1}` as ChessSquare;
      const piece = this.chess.get(sq);
      if (piece) return { type: piece.type as PieceSymbol, square: sq };
      f += stepF;
      r += stepR;
    }
    return null;
  }

  /** The enemy slider pinning the piece on `from` to its king, or null. */
  private findPinner(
    from: SquareName,
    color: 'w' | 'b',
  ): { type: PieceSymbol; square: SquareName } | null {
    const king = this.kingSquare(color === 'w' ? 'white' : 'black');
    if (!king) return null;
    const kf = king.col;
    const kr = king.row;
    const pf = FILES.indexOf(from[0]);
    const pr = Number(from[1]) - 1;
    const df = pf - kf;
    const dr = pr - kr;
    const onLine = df === 0 || dr === 0;
    const onDiagonal = Math.abs(df) === Math.abs(dr);
    if (!onLine && !onDiagonal) return null;
    const stepF = Math.sign(df);
    const stepR = Math.sign(dr);

    // Nothing may stand between the king and the (would-be pinned) piece.
    let f = kf + stepF;
    let r = kr + stepR;
    while (f !== pf || r !== pr) {
      if (this.chess.get(`${FILES[f]}${r + 1}` as ChessSquare)) return null;
      f += stepF;
      r += stepR;
    }

    // The first piece beyond it, on the same line, if enemy and a slider.
    f = pf + stepF;
    r = pr + stepR;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = `${FILES[f]}${r + 1}` as ChessSquare;
      const piece = this.chess.get(sq);
      if (piece) {
        const slides = piece.type === 'q' || piece.type === (onLine ? 'r' : 'b');
        if (piece.color !== color && slides) {
          return { type: piece.type as PieceSymbol, square: sq };
        }
        return null;
      }
      f += stepF;
      r += stepR;
    }
    return null;
  }

  /** Why a one-square king move is rejected: attacked square, or kings touching. */
  private kingStepProblem(color: 'w' | 'b', from: SquareName, to: SquareName): string {
    const enemy = color === 'w' ? 'b' : 'w';
    const scratch = new Chess(this.chess.fen());
    scratch.remove(from as ChessSquare);
    scratch.remove(to as ChessSquare);
    scratch.put({ type: 'k', color }, to as ChessSquare);
    const attackers = scratch.attackers(to as ChessSquare, enemy);
    if (attackers.length > 0) {
      const attacker = scratch.get(attackers[0]);
      if (attacker?.type === 'k') {
        return `The king can't move next to the other king — they must keep a square apart.`;
      }
      if (attacker) {
        return `The king can't move to ${to} — the ${PIECE_NAMES[attacker.type as PieceSymbol]} on ${attackers[0]} covers that square.`;
      }
      return `The king can't move to ${to} — that square is under attack.`;
    }
    return `That move would put your own king in check.`;
  }

  /** Why a castling attempt isn't available. */
  private castlingProblem(color: 'w' | 'b', side: 'k' | 'q'): string {
    const word = side === 'k' ? 'kingside' : 'queenside';
    if (!this.chess.getCastlingRights(color)[side]) {
      return `You can't castle ${word} any more — your king or that rook has already moved.`;
    }
    if (this.chess.isCheck()) return `You can't castle while your king is in check.`;
    const rank = color === 'w' ? '1' : '8';
    for (const file of side === 'k' ? ['f', 'g'] : ['b', 'c', 'd']) {
      if (this.chess.get(`${file}${rank}` as ChessSquare)) {
        return `Castling needs the squares between your king and rook empty — ${file}${rank} is occupied.`;
      }
    }
    const enemy = color === 'w' ? 'b' : 'w';
    for (const file of side === 'k' ? ['f', 'g'] : ['d', 'c']) {
      if (this.chess.isAttacked(`${file}${rank}` as ChessSquare, enemy)) {
        return `The king would pass through ${file}${rank}, which your opponent attacks — you can't castle through check.`;
      }
    }
    return `That castling move isn't available right now.`;
  }
}
