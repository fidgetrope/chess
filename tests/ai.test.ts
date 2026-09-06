import { describe, expect, it } from 'vitest';
import { chooseAiMove, DIFFICULTIES, type DifficultyConfig } from '../src/ai/difficulty.ts';
import { ChessGame } from '../src/core/game.ts';
import { evaluate } from '../src/ai/evaluate.ts';

/** A level's search with all the "play worse on purpose" randomness stripped out. */
function deterministic(config: DifficultyConfig): DifficultyConfig {
  return { ...config, blunderChance: 0, randomMoveChance: 0, evalNoise: 0 };
}

describe('chooseAiMove', () => {
  it('returns a legal move at every difficulty from the opening position', () => {
    const fen = new ChessGame().fen();
    for (const config of Object.values(DIFFICULTIES)) {
      const game = new ChessGame(fen);
      const legal = game.legalMoves();
      const move = chooseAiMove(fen, config);
      expect(move).not.toBeNull();
      expect(
        legal.some((m) => m.from === move!.from && m.to === move!.to && m.promotion === move!.promotion),
      ).toBe(true);
    }
  });

  it('returns null when the game is already over', () => {
    // Fool's mate position, Black already mated? Use a mated FEN for White.
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(chooseAiMove(fen, DIFFICULTIES.hard)).toBeNull();
  });

  it('finds the mate-in-one at Hard depth (Scholar\'s mate)', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
    const move = chooseAiMove(fen, deterministic(DIFFICULTIES.hard));
    expect(move).not.toBeNull();
    expect(move!.from).toBe('h5');
    expect(move!.to).toBe('f7');
  });

  it('grabs a hanging queen at Medium depth', () => {
    // Black to move: ...Qxd5 wins the undefended White queen.
    const fen = '4k3/8/2q5/3Q4/8/8/8/4K3 b - - 0 1';
    const move = chooseAiMove(fen, deterministic(DIFFICULTIES.medium));
    expect(move).not.toBeNull();
    expect(move!.to).toBe('d5');
  });
});

describe('evaluate', () => {
  it('is roughly symmetric at the start (side-to-move perspective)', () => {
    const game = new ChessGame();
    expect(Math.abs(evaluate(game))).toBeLessThan(50);
  });

  it('favours the side that is a whole rook up', () => {
    // White is missing its a1 rook.
    const game = new ChessGame('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w KQkq - 0 1');
    // Score is from White's perspective here (White to move); a missing
    // White rook should make it clearly negative.
    expect(evaluate(game)).toBeLessThan(-400);
  });
});
