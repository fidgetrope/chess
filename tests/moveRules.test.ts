import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/core/game.ts';

/**
 * `explainIllegalMove` powers the "explain moves I can't make" aid: given a
 * piece and a square the player tapped, it returns a one-sentence reason or
 * null if the move is actually legal.
 */
describe('ChessGame.explainIllegalMove', () => {
  it('returns null for a legal move', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('e2', 'e4')).toBeNull();
  });

  it('flags trying to capture your own piece', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('b1', 'd2')).toMatch(/your own pawn/i);
  });

  it('explains a bishop moving straight', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('c1', 'c3')).toMatch(/bishop moves only along diagonals/i);
  });

  it('names the piece blocking a slider', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('c1', 'a3')).toMatch(/pawn on b2 is in the way/i);
  });

  it('explains a knight moving off its L', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('b1', 'b3')).toMatch(/knight moves in an L/i);
  });

  it('explains a pawn trying to capture straight ahead', () => {
    const game = new ChessGame('4k3/8/8/8/4r3/4P3/8/4K3 w - - 0 1');
    expect(game.explainIllegalMove('e3', 'e4')).toMatch(/can't capture straight ahead/i);
  });

  it('explains a pawn moving diagonally with nothing to take', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('e2', 'f3')).toMatch(/diagonally only to capture/i);
  });

  it('explains a pinned piece', () => {
    const game = new ChessGame('4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(game.explainIllegalMove('e2', 'c3')).toMatch(/pinned.*rook on e8/i);
  });

  it('explains the king walking into an attacked square', () => {
    const game = new ChessGame('7k/8/8/8/8/8/r7/4K3 w - - 0 1');
    expect(game.explainIllegalMove('e1', 'e2')).toMatch(/rook on a2 covers that square/i);
  });

  it('explains that a move ignores an existing check', () => {
    const game = new ChessGame('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(game.explainIllegalMove('a2', 'a3')).toMatch(/king is in check/i);
  });

  it('explains castling blocked by pieces in the way', () => {
    const game = new ChessGame();
    expect(game.explainIllegalMove('e1', 'g1')).toMatch(/squares between your king and rook/i);
  });

  it('explains castling through an attacked square', () => {
    const game = new ChessGame('r3k2r/8/8/8/5r2/8/8/R3K2R w KQkq - 0 1');
    expect(game.explainIllegalMove('e1', 'g1')).toMatch(/pass through f1.*can't castle through check/i);
  });
});

describe('ChessGame.explainNoMoves', () => {
  it('explains a fully pinned piece', () => {
    // White Nc3 pinned to Ke1 by Bb4 (d2 empty).
    const game = new ChessGame('rnbqk1nr/pppp1ppp/8/4p3/1b2P3/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 1');
    expect(game.explainNoMoves('c3')).toMatch(/pinned by the bishop on b4/i);
  });

  it('explains a piece that cannot address a check', () => {
    const game = new ChessGame('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(game.explainNoMoves('a1')).toMatch(/king is in check/i);
  });

  it('stays silent for a piece that is merely hemmed in', () => {
    const game = new ChessGame();
    expect(game.explainNoMoves('c1')).toBeNull(); // opening bishop, no rule to state
  });
});
