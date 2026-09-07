import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/core/game.ts';
import { materialLossAfter } from '../src/ai/minimax.ts';

/**
 * The blunder guard warns on `materialLossAfter` — the centipawns the side
 * to move concretely loses once every forcing capture reply is played out.
 * These pin down the behaviour the "cheap fix" is meant to deliver: quiet
 * moves stay silent, real material losses are caught. (The spare g2/a2
 * pawns just keep the toy positions out of insufficient-material territory.)
 */
describe('materialLossAfter', () => {
  it('is ~zero for a safe developing move in the opening', () => {
    const game = new ChessGame();
    expect(materialLossAfter(game, { from: 'g1', to: 'f3' })).toBeLessThan(100);
    expect(materialLossAfter(game, { from: 'e2', to: 'e4' })).toBeLessThan(100);
  });

  it('is ~zero for winning a genuinely free pawn', () => {
    // White knight on c3, undefended black pawn on d5.
    const game = new ChessGame('4k3/8/8/3p4/8/2N5/6P1/4K3 w - - 0 1');
    expect(materialLossAfter(game, { from: 'c3', to: 'd5' })).toBeLessThan(100);
  });

  it('catches hanging a knight to a pawn (nothing recaptures)', () => {
    // White Ng1, black pawn e4; Nf3?? drops the knight to exf3.
    const game = new ChessGame('4k3/8/8/8/4p3/8/P7/4K1N1 w - - 0 1');
    expect(materialLossAfter(game, { from: 'g1', to: 'f3' })).toBeGreaterThan(300);
  });

  it('catches a knight-for-pawn trade on a defended square', () => {
    // Black pawns c6 and d5, c6 defends d5; Nxd5 cxd5 loses a knight for a pawn.
    const game = new ChessGame('4k3/8/2p5/3p4/8/2N5/6P1/4K3 w - - 0 1');
    const loss = materialLossAfter(game, { from: 'c3', to: 'd5' });
    expect(loss).toBeGreaterThan(180);
    expect(loss).toBeLessThan(300);
  });

  it('does not flag a move that wins material', () => {
    // e4xd5 wins a knight; a negative loss is clamped to 0.
    const game = new ChessGame('4k3/8/8/3n4/4P3/8/6P1/4K3 w - - 0 1');
    expect(materialLossAfter(game, { from: 'e4', to: 'd5' })).toBe(0);
  });
});
