import type { DifficultyLevel } from '../ai/difficulty.ts';
import type { Color, GameOutcome, PieceSymbol, ViewMode } from '../core/types.ts';

export type { ViewMode };

/** The "Play a friend" panel's state machine — one state visible at a time. */
export type MultiplayerUiState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'joining' }
  | { phase: 'waiting'; gameId: string; shareUrl: string }
  | { phase: 'active'; color: Color }
  | { phase: 'error'; message: string };

export interface UiCallbacks {
  onDifficultyChange: (level: DifficultyLevel) => void;
  onUndo: () => void;
  onRestart: () => void;
  onToggleView: () => void;
  onExplainMovesChange: (enabled: boolean) => void;
  onCreateGame: (hostColor: Color | 'random') => void;
  onJoinGame: (code: string) => void;
  onLeaveGame: () => void;
  /** The error view's OK button — just dismiss it, no game-state side effects. */
  onDismissMultiplayerError: () => void;
}

export interface UiHandle {
  setTurn: (text: string) => void;
  setCheck: (visible: boolean) => void;
  /** Sync the difficulty <select> to a value (e.g. a restored saved game). */
  setDifficulty: (level: DifficultyLevel) => void;
  /** `youColor` is which side you're playing — determines the glyph colour each tray renders. */
  setCaptured: (byYou: PieceSymbol[], byOpponent: PieceSymbol[], youColor: Color) => void;
  /** The "AI" / "Opponent" tag in the captured-piece tray. */
  setOpponentLabel: (text: string) => void;
  setMoveList: (sanPlies: string[]) => void;
  setUndoEnabled: (enabled: boolean) => void;
  /** Label the view button with whichever view it switches to. */
  setViewMode: (mode: ViewMode) => void;
  /** Close the Moves / settings drop-downs (e.g. when the player taps the board). */
  closePanels: () => void;
  /** Sync the "Explain moves I can't make" checkbox (e.g. from a restored game). */
  setExplainMoves: (explainMoves: boolean) => void;
  /** Show a one-line rules explanation (a rejected move), or clear it with null. */
  setRulesNote: (text: string | null) => void;
  /** Resolves with the piece the player chose to promote to. */
  askPromotion: () => Promise<PieceSymbol>;
  /** `opponentNoun` reads into "Checkmate — {opponentNoun} wins." — "the AI" solo, "your opponent" multiplayer. */
  showGameOver: (outcome: GameOutcome, myColor: Color, opponentNoun: string, online: boolean) => void;
  hideGameOver: () => void;
  /** Drives the "Play a friend" panel's create/join/waiting/active/error views. */
  setMultiplayerPanel: (state: MultiplayerUiState) => void;
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
  const sorted = [...pieces].sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));
  container.textContent = sorted.map((p) => GLYPHS[color][p]).join('');
}

function describeOutcome(outcome: GameOutcome, myColor: Color, opponentNoun: string): string {
  if (outcome.type === 'checkmate') {
    return outcome.winner === myColor ? 'Checkmate — you win! \u{1F3C6}' : `Checkmate — ${opponentNoun} wins.`;
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
 *
 * The HUD is deliberately minimal: a turn pill and a compact captured-piece
 * strip on the left, and three small buttons on the right. Difficulty /
 * Restart live behind the ⚙ button and the move history behind "Moves", so
 * neither covers the board unless the player opens it.
 */
export function createUi(callbacks: UiCallbacks): UiHandle {
  const turnIndicator = requireEl<HTMLDivElement>('turn-indicator');
  const checkBanner = requireEl<HTMLDivElement>('check-banner');
  const capturedTray = requireEl<HTMLDivElement>('captured-tray');
  const capturedByYou = requireEl<HTMLSpanElement>('captured-by-you');
  const capturedByAi = requireEl<HTMLSpanElement>('captured-by-ai');
  const opponentTag = requireEl<HTMLSpanElement>('opponent-tag');
  const difficultySelect = requireEl<HTMLSelectElement>('difficulty');
  const undoButton = requireEl<HTMLButtonElement>('undo');
  const restartButton = requireEl<HTMLButtonElement>('restart');
  const movesToggle = requireEl<HTMLButtonElement>('moves-toggle');
  const viewToggle = requireEl<HTMLButtonElement>('view-toggle');
  const menuToggle = requireEl<HTMLButtonElement>('menu-toggle');
  const movesPanel = requireEl<HTMLDivElement>('moves-panel');
  const menuPanel = requireEl<HTMLDivElement>('menu-panel');
  const rulesExplainBox = requireEl<HTMLInputElement>('rules-explain');
  const rulesNote = requireEl<HTMLDivElement>('rules-note');
  const moveList = requireEl<HTMLOListElement>('move-list');
  const promotionPicker = requireEl<HTMLDivElement>('promotion-picker');
  const promotionChoices = requireEl<HTMLDivElement>('promotion-choices');
  const gameOverOverlay = requireEl<HTMLDivElement>('game-over');
  const gameOverMessage = requireEl<HTMLParagraphElement>('game-over-message');
  const playAgainButton = requireEl<HTMLButtonElement>('play-again');
  const viewBoardButton = requireEl<HTMLButtonElement>('view-board');
  const soloControls = requireEl<HTMLDivElement>('solo-controls');
  const mpIdle = requireEl<HTMLDivElement>('mp-idle');
  const mpCreateBtn = requireEl<HTMLButtonElement>('mp-create');
  const mpColorSelect = requireEl<HTMLSelectElement>('mp-color-select');
  const mpCodeInput = requireEl<HTMLInputElement>('mp-code-input');
  const mpJoinBtn = requireEl<HTMLButtonElement>('mp-join');
  const mpBusy = requireEl<HTMLDivElement>('mp-busy');
  const mpBusyText = requireEl<HTMLParagraphElement>('mp-busy-text');
  const mpWaiting = requireEl<HTMLDivElement>('mp-waiting');
  const mpCode = requireEl<HTMLParagraphElement>('mp-code');
  const mpCopyLink = requireEl<HTMLButtonElement>('mp-copy-link');
  const mpLeaveWaiting = requireEl<HTMLButtonElement>('mp-leave-waiting');
  const mpActive = requireEl<HTMLDivElement>('mp-active');
  const mpActiveText = requireEl<HTMLParagraphElement>('mp-active-text');
  const mpLeaveActive = requireEl<HTMLButtonElement>('mp-leave-active');
  const mpError = requireEl<HTMLDivElement>('mp-error');
  const mpErrorText = requireEl<HTMLParagraphElement>('mp-error-text');
  const mpErrorOk = requireEl<HTMLButtonElement>('mp-error-ok');

  function setPanel(panel: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function closePanels(): void {
    setPanel(movesPanel, movesToggle, false);
    setPanel(menuPanel, menuToggle, false);
  }

  movesToggle.addEventListener('click', () => {
    const willOpen = movesPanel.hidden === true;
    closePanels();
    setPanel(movesPanel, movesToggle, willOpen);
  });
  menuToggle.addEventListener('click', () => {
    const willOpen = menuPanel.hidden === true;
    closePanels();
    setPanel(menuPanel, menuToggle, willOpen);
  });
  // Tapping anywhere that isn't a panel or its toggle dismisses the drop-downs.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (
      movesPanel.contains(target) ||
      menuPanel.contains(target) ||
      movesToggle.contains(target) ||
      menuToggle.contains(target)
    ) {
      return;
    }
    closePanels();
  });

  rulesExplainBox.addEventListener('change', () => {
    callbacks.onExplainMovesChange(rulesExplainBox.checked);
  });

  difficultySelect.addEventListener('change', () => {
    callbacks.onDifficultyChange(difficultySelect.value as DifficultyLevel);
  });
  undoButton.addEventListener('click', () => callbacks.onUndo());
  viewToggle.addEventListener('click', () => {
    closePanels();
    callbacks.onToggleView();
  });
  restartButton.addEventListener('click', () => {
    closePanels();
    callbacks.onRestart();
  });
  // Online, there's no "restart" (the game lives in Firestore), so the same
  // button leaves it instead and drops back to a fresh solo game.
  let gameOverOnline = false;
  playAgainButton.addEventListener('click', () => {
    if (gameOverOnline) callbacks.onLeaveGame();
    else callbacks.onRestart();
  });
  viewBoardButton.addEventListener('click', () => gameOverOverlay.classList.add('hidden'));

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

  // ---- "Play a friend" panel -------------------------------------------

  function renderMultiplayerPanel(state: MultiplayerUiState): void {
    soloControls.hidden = state.phase === 'waiting' || state.phase === 'active';
    mpIdle.hidden = state.phase !== 'idle';
    mpBusy.hidden = state.phase !== 'creating' && state.phase !== 'joining';
    mpWaiting.hidden = state.phase !== 'waiting';
    mpActive.hidden = state.phase !== 'active';
    mpError.hidden = state.phase !== 'error';

    if (state.phase === 'creating') mpBusyText.textContent = 'Creating your game…';
    if (state.phase === 'joining') mpBusyText.textContent = 'Joining…';
    if (state.phase === 'waiting') {
      mpCode.textContent = state.gameId;
      mpCopyLink.textContent = 'Copy invite link';
      mpCopyLink.dataset.url = state.shareUrl;
    }
    if (state.phase === 'active') {
      mpActiveText.textContent = `Playing a friend — you're ${state.color === 'white' ? 'White' : 'Black'}.`;
    }
    if (state.phase === 'error') {
      mpErrorText.textContent = state.message;
    }
  }

  mpCreateBtn.addEventListener('click', () => {
    callbacks.onCreateGame(mpColorSelect.value as Color | 'random');
  });
  mpJoinBtn.addEventListener('click', () => {
    if (mpCodeInput.value.trim()) callbacks.onJoinGame(mpCodeInput.value);
  });
  mpCodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && mpCodeInput.value.trim()) callbacks.onJoinGame(mpCodeInput.value);
  });
  mpCopyLink.addEventListener('click', () => {
    const url = mpCopyLink.dataset.url;
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        mpCopyLink.textContent = 'Copied!';
        setTimeout(() => {
          mpCopyLink.textContent = 'Copy invite link';
        }, 1800);
      })
      .catch(() => {
        mpCopyLink.textContent = url; // clipboard blocked — show it so it can be selected by hand
      });
  });
  mpLeaveWaiting.addEventListener('click', () => callbacks.onLeaveGame());
  mpLeaveActive.addEventListener('click', () => callbacks.onLeaveGame());
  mpErrorOk.addEventListener('click', () => callbacks.onDismissMultiplayerError());

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
    setCaptured(byYou, byOpponent, youColor) {
      const opponentColor: Color = youColor === 'white' ? 'black' : 'white';
      renderCaptured(capturedByYou, byYou, opponentColor); // what you capture is always the opponent's colour
      renderCaptured(capturedByAi, byOpponent, youColor);
      capturedTray.hidden = byYou.length === 0 && byOpponent.length === 0;
    },
    setOpponentLabel(text) {
      opponentTag.textContent = text;
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
    setViewMode(mode) {
      viewToggle.textContent = mode === '3d' ? '2D' : '3D';
      viewToggle.title = mode === '3d' ? 'Switch to the flat board' : 'Switch to the 3D board';
    },
    closePanels,
    setExplainMoves(explainMoves) {
      rulesExplainBox.checked = explainMoves;
    },
    setRulesNote(text) {
      if (text) {
        rulesNote.textContent = text;
        rulesNote.classList.remove('rules-note-idle');
      } else {
        rulesNote.classList.add('rules-note-idle');
      }
    },
    askPromotion() {
      closePanels();
      promotionPicker.classList.remove('hidden');
      return new Promise<PieceSymbol>((resolve) => {
        pendingPromotion = resolve;
      });
    },
    showGameOver(outcome, myColor, opponentNoun, online) {
      gameOverOnline = online;
      playAgainButton.textContent = online ? 'Leave game' : 'Play Again';
      gameOverMessage.textContent = describeOutcome(outcome, myColor, opponentNoun);
      gameOverOverlay.classList.remove('hidden');
    },
    hideGameOver() {
      gameOverOverlay.classList.add('hidden');
    },
    setMultiplayerPanel(state) {
      renderMultiplayerPanel(state);
    },
  };
}
