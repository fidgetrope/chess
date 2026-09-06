import type { DifficultyLevel } from '../ai/difficulty.ts';
import type { Color, GameOutcome, PieceSymbol } from '../core/types.ts';

export interface UiCallbacks {
  onDifficultyChange: (level: DifficultyLevel) => void;
  onUndo: () => void;
  onRestart: () => void;
}

export interface UiHandle {
  setTurn: (text: string) => void;
  setCheck: (visible: boolean) => void;
  /** Sync the difficulty <select> to a value (e.g. a restored saved game). */
  setDifficulty: (level: DifficultyLevel) => void;
  /** `byYou` = pieces the human captured (Black men); `byAi` = White men. */
  setCaptured: (byYou: PieceSymbol[], byAi: PieceSymbol[]) => void;
  setMoveList: (sanPlies: string[]) => void;
  setUndoEnabled: (enabled: boolean) => void;
  /** Resolves with the piece the player chose to promote to. */
  askPromotion: () => Promise<PieceSymbol>;
  showGameOver: (outcome: GameOutcome, humanColor: Color) => void;
  hideGameOver: () => void;
}

const GLYPHS: Record<Color, Record<PieceSymbol, string>> = {
  white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const PIECE_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`ui.ts: expected #${id} to exist in index.html`);
  return el as T;
}

function renderCaptured(container: HTMLElement, pieces: PieceSymbol[], color: Color): void {
  const sorted = [...pieces].sort(
    (a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b),
  );
  container.textContent = sorted.map((p) => GLYPHS[color][p]).join('');
}

function describeOutcome(outcome: GameOutcome, humanColor: Color): string {
  if (outcome.type === 'checkmate') {
    return outcome.winner === humanColor ? 'Checkmate — you win! \u{1F3C6}' : 'Checkmate — the AI wins.';
  }
  if (outcome.type === 'draw') {
    const reasons: Record<string, string> = {
      stalemate: 'Draw by stalemate.',
      'insufficient-material': 'Draw — insufficient material.',
      'threefold-repetition': 'Draw by threefold repetition.',
      'fifty-move-rule': 'Draw by the fifty-move rule.',
      agreed: 'Draw agreed.',
    };
    return reasons[outcome.reason] ?? 'Draw.';
  }
  return '';
}

/**
 * Framework-free DOM view layer. Grabs the overlay markup already present
 * in index.html, wires its interactive controls, and exposes small setters
 * for gameController.ts to push state into. Never imports from render/.
 */
export function createUi(callbacks: UiCallbacks): UiHandle {
  const turnIndicator = requireEl<HTMLDivElement>('turn-indicator');
  const checkBanner = requireEl<HTMLDivElement>('check-banner');
  const capturedByYou = requireEl<HTMLDivElement>('captured-by-you').querySelector<HTMLSpanElement>('.captured-pieces')!;
  const capturedByAi = requireEl<HTMLDivElement>('captured-by-ai').querySelector<HTMLSpanElement>('.captured-pieces')!;
  const difficultySelect = requireEl<HTMLSelectElement>('difficulty');
  const undoButton = requireEl<HTMLButtonElement>('undo');
  const restartButton = requireEl<HTMLButtonElement>('restart');
  const moveList = requireEl<HTMLOListElement>('move-list');
  const promotionPicker = requireEl<HTMLDivElement>('promotion-picker');
  const promotionChoices = requireEl<HTMLDivElement>('promotion-choices');
  const gameOverOverlay = requireEl<HTMLDivElement>('game-over');
  const gameOverMessage = requireEl<HTMLParagraphElement>('game-over-message');
  const playAgainButton = requireEl<HTMLButtonElement>('play-again');

  difficultySelect.addEventListener('change', () => {
    callbacks.onDifficultyChange(difficultySelect.value as DifficultyLevel);
  });
  undoButton.addEventListener('click', () => callbacks.onUndo());
  restartButton.addEventListener('click', () => callbacks.onRestart());
  playAgainButton.addEventListener('click', () => callbacks.onRestart());

  let pendingPromotion: ((piece: PieceSymbol) => void) | null = null;
  promotionChoices.querySelectorAll<HTMLButtonElement>('button[data-piece]').forEach((button) => {
    button.addEventListener('click', () => {
      const piece = button.dataset.piece as PieceSymbol;
      promotionPicker.classList.add('hidden');
      const resolve = pendingPromotion;
      pendingPromotion = null;
      resolve?.(piece);
    });
  });

  return {
    setTurn(text) {
      turnIndicator.textContent = text;
    },
    setCheck(visible) {
      checkBanner.classList.toggle('hidden', !visible);
    },
    setDifficulty(level) {
      difficultySelect.value = level;
    },
    setCaptured(byYou, byAi) {
      renderCaptured(capturedByYou, byYou, 'black');
      renderCaptured(capturedByAi, byAi, 'white');
    },
    setMoveList(sanPlies) {
      moveList.replaceChildren();
      for (let i = 0; i < sanPlies.length; i += 2) {
        const li = document.createElement('li');
        const white = document.createElement('span');
        white.className = 'ply';
        white.textContent = sanPlies[i];
        li.appendChild(white);
        if (sanPlies[i + 1]) {
          const black = document.createElement('span');
          black.className = 'ply';
          black.textContent = sanPlies[i + 1];
          li.appendChild(black);
        }
        moveList.appendChild(li);
      }
      const lastPly = moveList.querySelector<HTMLElement>('li:last-child .ply:last-child');
      lastPly?.classList.add('current');
      moveList.scrollTop = moveList.scrollHeight;
    },
    setUndoEnabled(enabled) {
      undoButton.disabled = !enabled;
    },
    askPromotion() {
      promotionPicker.classList.remove('hidden');
      return new Promise<PieceSymbol>((resolve) => {
        pendingPromotion = resolve;
      });
    },
    showGameOver(outcome, humanColor) {
      gameOverMessage.textContent = describeOutcome(outcome, humanColor);
      gameOverOverlay.classList.remove('hidden');
    },
    hideGameOver() {
      gameOverOverlay.classList.add('hidden');
    },
  };
}
