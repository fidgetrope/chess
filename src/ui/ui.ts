import type { DifficultyLevel } from '../ai/difficulty.ts';
import type { Color, GameOutcome, PieceSymbol, ViewMode } from '../core/types.ts';

export type { ViewMode };

export interface CoachAdvice {
  /** A standing line, shown only when the position is decisive; null hides it. */
  standing: string | null;
  /** A threat warning, or a reassuring "no immediate threats" line. */
  threat: string;
  /** The hinted move — populated but kept hidden until the player asks. */
  hint: { text: string; reason: string; from: string; to: string } | null;
}

export interface UiCallbacks {
  onDifficultyChange: (level: DifficultyLevel) => void;
  onUndo: () => void;
  onRestart: () => void;
  onToggleView: () => void;
  onCoachEnabledChange: (enabled: boolean) => void;
  onBlunderWarnChange: (enabled: boolean) => void;
  /** Fired when the coach panel is opened, so the controller can refresh the advice. */
  onCoachPanelOpened: () => void;
  /** Fired when the hint is shown/hidden, so the controller can highlight the move. */
  onHintRevealed: (shown: boolean, move: { from: string; to: string } | null) => void;
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
  /** Label the view button with whichever view it switches to. */
  setViewMode: (mode: ViewMode) => void;
  /** Close the Moves / Coach / settings drop-downs (e.g. when the player taps the board). */
  closePanels: () => void;
  /** Sync the coach checkboxes (e.g. from a restored game). */
  setCoachSettings: (enabled: boolean, blunderWarn: boolean) => void;
  /** Show a placeholder while the coach is analysing. */
  setCoachThinking: () => void;
  /** Fill the coach panel with fresh advice (hint stays hidden until "Show a hint"). */
  setCoachAdvice: (advice: CoachAdvice) => void;
  /** True while the coach panel is open. */
  isCoachPanelOpen: () => boolean;
  /** Ask the player to confirm a move the coach flagged as a blunder. */
  askBlunderConfirm: (message: string) => Promise<boolean>;
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
  const sorted = [...pieces].sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));
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
  const difficultySelect = requireEl<HTMLSelectElement>('difficulty');
  const undoButton = requireEl<HTMLButtonElement>('undo');
  const restartButton = requireEl<HTMLButtonElement>('restart');
  const movesToggle = requireEl<HTMLButtonElement>('moves-toggle');
  const coachToggle = requireEl<HTMLButtonElement>('coach-toggle');
  const viewToggle = requireEl<HTMLButtonElement>('view-toggle');
  const menuToggle = requireEl<HTMLButtonElement>('menu-toggle');
  const movesPanel = requireEl<HTMLDivElement>('moves-panel');
  const menuPanel = requireEl<HTMLDivElement>('menu-panel');
  const coachPanel = requireEl<HTMLDivElement>('coach-panel');
  const coachAdviceEl = requireEl<HTMLDivElement>('coach-advice');
  const coachStanding = requireEl<HTMLParagraphElement>('coach-standing');
  const coachThreat = requireEl<HTMLParagraphElement>('coach-threat');
  const coachHintBtn = requireEl<HTMLButtonElement>('coach-hint-btn');
  const coachHint = requireEl<HTMLParagraphElement>('coach-hint');
  const coachHintMove = requireEl<HTMLElement>('coach-hint-move');
  const coachHintReason = requireEl<HTMLSpanElement>('coach-hint-reason');
  const coachEnabledBox = requireEl<HTMLInputElement>('coach-enabled');
  const coachBlunderBox = requireEl<HTMLInputElement>('coach-blunder');
  const moveList = requireEl<HTMLOListElement>('move-list');
  const promotionPicker = requireEl<HTMLDivElement>('promotion-picker');
  const promotionChoices = requireEl<HTMLDivElement>('promotion-choices');
  const gameOverOverlay = requireEl<HTMLDivElement>('game-over');
  const gameOverMessage = requireEl<HTMLParagraphElement>('game-over-message');
  const playAgainButton = requireEl<HTMLButtonElement>('play-again');
  const blunderDialog = requireEl<HTMLDivElement>('blunder-dialog');
  const blunderMessage = requireEl<HTMLParagraphElement>('blunder-message');
  const blunderBack = requireEl<HTMLButtonElement>('blunder-back');
  const blunderPlay = requireEl<HTMLButtonElement>('blunder-play');

  let currentHint: { from: string; to: string } | null = null;

  function setPanel(panel: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function closePanels(): void {
    setPanel(movesPanel, movesToggle, false);
    setPanel(menuPanel, menuToggle, false);
    setPanel(coachPanel, coachToggle, false);
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
  function showCoachPlaceholder(): void {
    coachStanding.hidden = true;
    coachThreat.classList.remove('coach-warn');
    coachThreat.textContent = coachEnabledBox.checked
      ? 'Thinking…'
      : 'Turn the coach on to get advice on your move.';
    coachHint.hidden = true;
    coachHintBtn.hidden = true;
  }

  coachToggle.addEventListener('click', () => {
    const willOpen = coachPanel.hidden === true;
    closePanels();
    setPanel(coachPanel, coachToggle, willOpen);
    if (willOpen) {
      showCoachPlaceholder();
      callbacks.onCoachPanelOpened();
    }
  });

  // Tapping anywhere that isn't a panel or its toggle dismisses the drop-downs.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (
      movesPanel.contains(target) ||
      menuPanel.contains(target) ||
      coachPanel.contains(target) ||
      movesToggle.contains(target) ||
      menuToggle.contains(target) ||
      coachToggle.contains(target)
    ) {
      return;
    }
    closePanels();
  });

  function hideHint(): void {
    coachHint.hidden = true;
    coachHintBtn.hidden = false;
    if (currentHint) callbacks.onHintRevealed(false, currentHint);
  }

  coachHintBtn.addEventListener('click', () => {
    coachHint.hidden = false;
    coachHintBtn.hidden = true;
    if (currentHint) callbacks.onHintRevealed(true, currentHint);
  });

  coachEnabledBox.addEventListener('change', () => {
    callbacks.onCoachEnabledChange(coachEnabledBox.checked);
  });
  coachBlunderBox.addEventListener('change', () => {
    callbacks.onBlunderWarnChange(coachBlunderBox.checked);
  });

  let pendingBlunder: ((play: boolean) => void) | null = null;
  function resolveBlunder(play: boolean): void {
    blunderDialog.classList.add('hidden');
    const resolve = pendingBlunder;
    pendingBlunder = null;
    resolve?.(play);
  }
  blunderBack.addEventListener('click', () => resolveBlunder(false));
  blunderPlay.addEventListener('click', () => resolveBlunder(true));

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
      capturedTray.hidden = byYou.length === 0 && byAi.length === 0;
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
    setCoachSettings(enabled, blunderWarn) {
      coachEnabledBox.checked = enabled;
      coachBlunderBox.checked = blunderWarn;
      coachAdviceEl.classList.toggle('coach-off', !enabled);
      if (!enabled && coachPanel.hidden === false) showCoachPlaceholder();
    },
    setCoachThinking() {
      coachStanding.hidden = true;
      coachThreat.textContent = coachEnabledBox.checked ? 'Thinking…' : 'Turn the coach on for advice.';
      coachThreat.classList.remove('coach-warn');
      currentHint = null;
      coachHint.hidden = true;
      coachHintBtn.hidden = !coachEnabledBox.checked;
    },
    setCoachAdvice(advice) {
      coachStanding.hidden = !advice.standing;
      if (advice.standing) coachStanding.textContent = advice.standing;

      coachThreat.textContent = advice.threat;
      coachThreat.classList.toggle('coach-warn', advice.threat.startsWith('Watch out'));

      currentHint = advice.hint ? { from: advice.hint.from, to: advice.hint.to } : null;
      if (advice.hint) {
        coachHintMove.textContent = advice.hint.text;
        coachHintReason.textContent = ` — ${advice.hint.reason}`;
      }
      hideHint();
      coachHintBtn.hidden = !advice.hint;
    },
    isCoachPanelOpen() {
      return coachPanel.hidden === false;
    },
    askBlunderConfirm(message) {
      closePanels();
      blunderMessage.textContent = message;
      blunderDialog.classList.remove('hidden');
      return new Promise<boolean>((resolve) => {
        pendingBlunder = resolve;
      });
    },
    askPromotion() {
      closePanels();
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
