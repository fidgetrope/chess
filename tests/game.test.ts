import { describe, expect, it } from 'vitest';
import { ChessGame, squareName, squareToGrid } from '../src/core/game.ts';

describe('coordinate mapping', () => {
  it('round-trips grid <-> algebraic', () => {
    for (const name of ['a1', 'h8', 'e4', 'd7', 'c2']) {
      expect(squareName(squareToGrid(name))).toBe(name);
    }
  });

  it('puts a1 at row 0 col 0 and h8 at row 7 col 7', () => {
    expect(squareToGrid('a1')).toEqual({ row: 0, col: 0 });
    expect(squareToGrid('h8')).toEqual({ row: 7, col: 7 });
  });
});

describe('opening position', () => {
  it('has 20 legal moves for White', () => {
    const game = new ChessGame();
    expect(game.legalMoves()).toHaveLength(20);
    expect(game.turn).toBe('white');
    expect(game.outcome()).toEqual({ type: 'in-progress' });
  });

  it('reports a piece on e2 and nothing on e4', () => {
    const game = new ChessGame();
    expect(game.pieceAt(squareToGrid('e2'))).toEqual({ color: 'white', type: 'p' });
    expect(game.pieceAt(squareToGrid('e4'))).toBeNull();
  });
});

describe('special moves', () => {
  it('flags a castling move and lets the wrapper apply it', () => {
    const game = new ChessGame('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    const castle = game.legalMoves().find((m) => m.san === 'O-O');
    expect(castle).toBeDefined();
    expect(castle!.isCastle).toBe(true);
    game.move({ from: castle!.from, to: castle!.to });
    expect(game.pieceAt(squareToGrid('g1'))).toEqual({ color: 'white', type: 'k' });
    expect(game.pieceAt(squareToGrid('f1'))).toEqual({ color: 'white', type: 'r' });
  });

  it('flags an en-passant capture', () => {
    const game = new ChessGame('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    const ep = game.legalMoves().find((m) => m.isEnPassant);
    expect(ep).toBeDefined();
    expect(ep!.from).toBe('e5');
    expect(ep!.to).toBe('f6');
    game.move({ from: 'e5', to: 'f6' });
    expect(game.pieceAt(squareToGrid('f5'))).toBeNull(); // captured pawn removed
  });

  it('offers all four promotion pieces on the last rank', () => {
    const game = new ChessGame('8/P7/8/8/8/8/8/k6K w - - 0 1');
    const promos = game.legalMoves().filter((m) => m.isPromotion);
    expect(promos.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    game.move({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(game.pieceAt(squareToGrid('a8'))).toEqual({ color: 'white', type: 'q' });
  });
});

describe('outcome detection', () => {
  it('detects fool\'s mate as checkmate for Black', () => {
    const game = new ChessGame();
    game.move({ from: 'f2', to: 'f3' });
    game.move({ from: 'e7', to: 'e5' });
    game.move({ from: 'g2', to: 'g4' });
    game.move({ from: 'd8', to: 'h4' });
    expect(game.isGameOver()).toBe(true);
    expect(game.outcome()).toEqual({ type: 'checkmate', winner: 'black' });
  });

  it('detects stalemate as a draw', () => {
    const game = new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(game.outcome()).toEqual({ type: 'draw', reason: 'stalemate' });
  });

  it('detects king-vs-king as insufficient material', () => {
    const game = new ChessGame('8/8/8/4k3/8/8/3K4/8 w - - 0 1');
    expect(game.outcome()).toEqual({ type: 'draw', reason: 'insufficient-material' });
  });
});

describe('history and undo', () => {
  it('records SAN and reverses cleanly', () => {
    const game = new ChessGame();
    const openingFen = game.fen();
    game.move({ from: 'e2', to: 'e4' });
    game.move({ from: 'c7', to: 'c5' });
    expect(game.history()).toEqual(['e4', 'c5']);
    game.undo();
    game.undo();
    expect(game.fen()).toBe(openingFen);
    expect(game.history()).toEqual([]);
  });
});
