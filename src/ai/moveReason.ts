import type { Color, MoveOption, PieceSymbol } from '../core/types.ts';

// A short plain-English "why" for a move, built from its shape — capture,
// castle, check, a piece leaving the back rank, a central pawn push. It is
// templated, not clever; it falls back to something vague rather than
// claiming a plan it can't see.

const NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const CENTRE_FILES = new Set(['c', 'd', 'e', 'f']);

export function reasonFor(move: MoveOption, mover: Color): string {
  if (move.san.endsWith('#')) return 'delivers checkmate';

  const checks = move.san.endsWith('+');
  const check = checks ? 'gives check and ' : '';

  if (move.isCastle) {
    return `${check}castles — the king tucks away and a rook joins in`;
  }
  if (move.isPromotion && move.promotion) {
    return `${check}promotes to a ${NAME[move.promotion]}`;
  }
  if (move.isCapture && move.captured) {
    const what = move.captured === 'p' ? 'a pawn' : `the ${NAME[move.captured]}`;
    return `${check}wins ${what}`;
  }
  if (checks) return 'gives check';

  const backRank = mover === 'white' ? '1' : '8';
  const fromRank = move.from[1];
  const toFile = move.to[0];

  if (move.piece === 'p') {
    const twoSquares = Math.abs(Number(fromRank) - Number(move.to[1])) === 2;
    if (CENTRE_FILES.has(toFile) && twoSquares) return 'stakes a claim in the centre';
    return 'a handy pawn move — gains a little space';
  }
  if ((move.piece === 'n' || move.piece === 'b') && fromRank === backRank) {
    return `develops the ${NAME[move.piece]} toward the middle`;
  }
  if (move.piece === 'r' && CENTRE_FILES.has(toFile)) {
    return 'brings the rook toward the centre';
  }
  if (move.piece === 'q' && fromRank === backRank) {
    return 'brings the queen out — fine here, though minor pieces usually come first';
  }
  if (move.piece === 'k') return 'walks the king to safety';

  return 'keeps things solid and improves a piece';
}
