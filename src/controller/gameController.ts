import * as THREE from 'three';
import AiWorker from '../ai/worker.ts?worker';
import type { AiRequest, AiResponse } from '../ai/worker.ts';
import CoachWorker from '../ai/coachWorker.ts?worker';
import type { CoachRequest, CoachResponse } from '../ai/coachWorker.ts';
import type { DifficultyLevel } from '../ai/difficulty.ts';
import { ChessGame, squareToGrid } from '../core/game.ts';
import { loadGame, saveGame } from '../core/persistence.ts';
import type { Color, MoveOption, PieceSymbol, Square, ViewMode } from '../core/types.ts';
import { animateCapture, animateMove, animatePromotionReveal } from '../render/animation.ts';
import { createBoard2d } from '../render/board2d.ts';
import { buildBoardMeshes, type TileMesh } from '../render/boardMesh.ts';
import { updateHighlights } from '../render/highlight.ts';
import { setupPicking } from '../render/picking.ts';
import { createPieceMesh, type PieceMesh } from '../render/pieceMesh.ts';
import { createScene, startRenderLoop } from '../render/scene.ts';
import { createUi } from '../ui/ui.ts';

const HUMAN_COLOR: Color = 'white';
const AI_COLOR: Color = 'black';
const AI_MIN_THINK_MS = 300; // floor so the "AI thinking…" label is legible even on instant replies

/** Wires core (rules/AI) + render (Three.js) + ui together. The only module that imports across all of them. */
export function startGame(container: HTMLElement): void {
  const sceneRefs = createScene(container);
  const tiles: TileMesh[] = buildBoardMeshes(sceneRefs.boardGroup);

  let game = new ChessGame();
  let difficulty: DifficultyLevel = 'easy';
  let viewMode: ViewMode = '3d';
  let selected: Square | null = null;
  let legalFromSelected: MoveOption[] = [];
  let busy = false; // true while animating or waiting on the AI
  let aiRequestId = 0;
  let pendingAi: { requestId: number; startedAt: number } | null = null;
  let setRenderLoopActive: (active: boolean) => void = () => {};

  // Coach (opt-in): a second worker analyses the human's turn, off by default.
  let coachEnabled = false;
  let blunderWarnEnabled = false;
  let coachRequestId = 0;
  let latestCoach: CoachResponse | null = null;
  let hintMove: { from: string; to: string } | null = null;
  let pendingBlunderCheck: { requestId: number; resolve: (b: CoachResponse['blunder']) => void } | null = null;

  const worker = new AiWorker();

  // The coach worker is created lazily the first time the coach is actually
  // used, so a player who never turns it on never downloads the extra chunk.
  let coachWorker: Worker | null = null;
  function getCoachWorker(): Worker {
    if (!coachWorker) {
      coachWorker = new CoachWorker();
      coachWorker.onmessage = onCoachMessage;
    }
    return coachWorker;
  }
  const pieceMeshes = new Map<string, PieceMesh>(); // keyed by algebraic square name

  const board2d = createBoard2d((square) => void handlePick(square));
  container.insertAdjacentElement('afterend', board2d.element);

  function squareKey(square: Square): string {
    return `${'abcdefgh'[square.col]}${square.row + 1}`;
  }

  function rebuildPieceMeshes(): void {
    sceneRefs.pieceGroup.clear();
    pieceMeshes.clear();
    const board = game.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (!piece) continue;
        const square = { row, col };
        const mesh = createPieceMesh(square, piece);
        sceneRefs.pieceGroup.add(mesh);
        pieceMeshes.set(squareKey(square), mesh);
      }
    }
  }

  function lastMovePair(): { from: string; to: string } | null {
    const history = game.detailedHistory();
    const last = history[history.length - 1];
    return last ? { from: last.from, to: last.to } : null;
  }

  /** Push the current selection / legal-move / check / hint state into whichever board is showing. */
  function refreshView(): void {
    const checkSquare = game.inCheck() ? game.kingSquare(game.turn) : null;
    if (viewMode === '3d') {
      updateHighlights(sceneRefs.highlightGroup, {
        selected,
        moves: legalFromSelected,
        checkSquare,
        hintMove,
      });
    } else {
      board2d.render({
        board: game.board(),
        selected,
        moves: legalFromSelected,
        checkSquare,
        lastMove: lastMovePair(),
        hintMove,
      });
    }
  }

  // ---- Coach ----------------------------------------------------------------

  function pushCoachAdvice(): void {
    if (!coachEnabled || !latestCoach) return;
    ui.setCoachAdvice({
      standing: latestCoach.standing,
      threat: latestCoach.threat?.text ?? 'No immediate threats.',
      hint: latestCoach.hint
        ? {
            text: latestCoach.hint.san,
            reason: latestCoach.hint.reason,
            from: latestCoach.hint.from,
            to: latestCoach.hint.to,
          }
        : null,
    });
  }

  /** Analyse the current position for the coach panel — only on the human's turn, only when enabled. */
  function requestCoachAnalysis(): void {
    hintMove = null;
    latestCoach = null;
    if (
      !coachEnabled ||
      busy ||
      game.turn !== HUMAN_COLOR ||
      game.outcome().type !== 'in-progress'
    ) {
      return;
    }
    const requestId = ++coachRequestId;
    if (ui.isCoachPanelOpen()) ui.setCoachThinking();
    getCoachWorker().postMessage({
      requestId,
      fen: game.fen(),
      humanColor: HUMAN_COLOR,
      mode: 'panel',
    } satisfies CoachRequest);
  }

  function requestBlunderCheck(move: MoveOption): Promise<CoachResponse['blunder']> {
    return new Promise((resolve) => {
      const requestId = ++coachRequestId;
      pendingBlunderCheck = { requestId, resolve };
      getCoachWorker().postMessage({
        requestId,
        fen: game.fen(),
        humanColor: HUMAN_COLOR,
        mode: 'blunderCheck',
        move: { from: move.from, to: move.to, promotion: move.promotion },
      } satisfies CoachRequest);
    });
  }

  function blunderPhrase(verdict: NonNullable<CoachResponse['blunder']>): string {
    if (verdict.intoMate) return 'walks into a forced mate';
    if (verdict.dropCp >= 650) return 'looks like it drops a piece';
    if (verdict.dropCp >= 300) return 'looks like it loses material';
    return 'looks like a mistake';
  }

  /** Returns false only when the coach flags a blunder and the player chooses to take it back. */
  async function confirmMove(move: MoveOption): Promise<boolean> {
    if (!blunderWarnEnabled) return true;
    // The coach's own top move is never a blunder.
    if (latestCoach?.hint && latestCoach.hint.from === move.from && latestCoach.hint.to === move.to) {
      return true;
    }
    const verdict = await requestBlunderCheck(move);
    if (!verdict) return true;
    return ui.askBlunderConfirm(
      `That ${blunderPhrase(verdict)} — the engine prefers ${verdict.bestSan}. Play it anyway?`,
    );
  }

  function onCoachMessage(event: MessageEvent<CoachResponse>): void {
    const msg = event.data;
    if (msg.mode === 'blunderCheck') {
      if (pendingBlunderCheck?.requestId === msg.requestId) {
        const resolve = pendingBlunderCheck.resolve;
        pendingBlunderCheck = null;
        resolve(msg.blunder);
      }
      return;
    }
    if (msg.requestId !== coachRequestId) return; // stale
    latestCoach = msg;
    if (ui.isCoachPanelOpen()) pushCoachAdvice();
  }

  function updateCapturedUi(): void {
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];
    // White plays plies 0, 2, 4…; the captured man is the opposite colour
    // to whoever moved on that ply.
    game.detailedHistory().forEach((move, ply) => {
      if (!move.captured) return;
      (ply % 2 === 0 ? byWhite : byBlack).push(move.captured);
    });
    ui.setCaptured(byWhite, byBlack);
  }

  function updateStatusUi(): void {
    const outcome = game.outcome();
    if (outcome.type !== 'in-progress') {
      ui.setTurn('Game over');
      ui.setCheck(false);
      ui.showGameOver(outcome, HUMAN_COLOR);
      return;
    }
    ui.hideGameOver();
    ui.setTurn(game.turn === HUMAN_COLOR ? 'Your turn' : 'AI thinking…');
    ui.setCheck(game.inCheck());
  }

  function persist(): void {
    saveGame({
      moves: game
        .detailedHistory()
        .map((m) => ({ from: m.from, to: m.to, promotion: m.promotion })),
      difficulty,
      view: viewMode,
      coach: coachEnabled,
      blunderWarn: blunderWarnEnabled,
    });
  }

  /** Swap the on-screen board, pausing the WebGL loop while the flat board covers it. */
  function applyViewMode(): void {
    board2d.setVisible(viewMode === '2d');
    setRenderLoopActive(viewMode === '3d');
    ui.setViewMode(viewMode);
    if (viewMode === '3d') rebuildPieceMeshes();
    refreshView();
  }

  function toggleView(): void {
    viewMode = viewMode === '3d' ? '2d' : '3d';
    applyViewMode();
    persist();
  }

  function syncUiAfterMove(): void {
    ui.setMoveList(game.history());
    updateCapturedUi();
    ui.setUndoEnabled(!busy && game.plyCount() > 0 && game.turn === HUMAN_COLOR);
    updateStatusUi();
    requestCoachAnalysis(); // clears any stale hint; fires a fresh analysis on the human's turn
    refreshView();
    persist();
  }

  function clearSelection(): void {
    selected = null;
    legalFromSelected = [];
    refreshView();
  }

  /** Runs the 3D slide / capture / castle animations. No-op in the flat view. */
  async function animateMoveMeshes(move: MoveOption): Promise<void> {
    const mover = pieceMeshes.get(move.from) ?? null;
    const capturedKey = move.isEnPassant ? `${move.to[0]}${move.from[1]}` : move.to;
    const capturedMesh = move.isCapture ? (pieceMeshes.get(capturedKey) ?? null) : null;

    const animations: Promise<void>[] = [];
    if (mover) {
      pieceMeshes.delete(move.from);
      animations.push(
        animateMove(mover, squareToGrid(move.from), squareToGrid(move.to), {
          arcHeight: move.piece === 'n' ? 0.7 : 0.15,
        }),
      );
    }
    if (capturedMesh) animations.push(animateCapture(capturedMesh));
    if (move.isCastle) {
      const rank = move.from[1];
      const kingside = move.to[0] === 'g';
      const rookFrom = `${kingside ? 'h' : 'a'}${rank}`;
      const rookMesh = pieceMeshes.get(rookFrom);
      if (rookMesh) {
        pieceMeshes.delete(rookFrom);
        animations.push(
          animateMove(rookMesh, squareToGrid(rookFrom), squareToGrid(`${kingside ? 'f' : 'd'}${rank}`)),
        );
      }
    }

    await Promise.all(animations);
    if (capturedMesh) sceneRefs.pieceGroup.remove(capturedMesh);
  }

  async function playMove(move: MoveOption): Promise<void> {
    busy = true;
    ui.setUndoEnabled(false);
    clearSelection();

    if (viewMode === '3d') {
      await animateMoveMeshes(move);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 140)); // a small beat before the piece jumps
    }

    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    rebuildPieceMeshes();

    if (move.isPromotion && viewMode === '3d') {
      const promoted = pieceMeshes.get(move.to);
      if (promoted) await animatePromotionReveal(promoted);
    }

    busy = false;
    syncUiAfterMove();

    if (game.outcome().type === 'in-progress' && game.turn === AI_COLOR) {
      requestAiMove();
    }
  }

  function requestAiMove(): void {
    busy = true;
    ui.setUndoEnabled(false);
    const requestId = ++aiRequestId;
    const startedAt = performance.now();
    const request: AiRequest = { requestId, fen: game.fen(), difficulty };
    worker.postMessage(request);

    // The worker replies via the shared onmessage handler below; it
    // dispatches by requestId so a stale reply (after undo/restart) is dropped.
    pendingAi = { requestId, startedAt };
  }

  worker.onmessage = (event: MessageEvent<AiResponse>) => {
    const { requestId, move } = event.data;
    if (!pendingAi || requestId !== pendingAi.requestId) return; // stale
    const wait = Math.max(0, AI_MIN_THINK_MS - (performance.now() - pendingAi.startedAt));
    pendingAi = null;
    setTimeout(() => {
      busy = false;
      if (!move) {
        syncUiAfterMove();
        return;
      }
      const chosen = game
        .legalMoves()
        .find(
          (m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion,
        );
      if (chosen) void playMove(chosen);
    }, wait);
  };

  async function handlePick(square: Square | null): Promise<void> {
    if (busy || game.outcome().type !== 'in-progress' || game.turn !== HUMAN_COLOR) return;
    if (!square) {
      clearSelection();
      return;
    }

    if (selected) {
      const matches = legalFromSelected.filter((m) => m.to === squareKey(square));
      if (matches.length > 0) {
        let move = matches[0];
        if (move.isPromotion) {
          const piece = await ui.askPromotion();
          move = matches.find((m) => m.promotion === piece) ?? move;
        }
        if (!(await confirmMove(move))) {
          clearSelection();
          return;
        }
        await playMove(move);
        return;
      }
    }

    const piece = game.pieceAt(square);
    if (piece && piece.color === HUMAN_COLOR) {
      const moves = game.legalMovesFrom(square);
      if (moves.length === 0) {
        clearSelection();
        return;
      }
      selected = square;
      legalFromSelected = moves;
      refreshView();
      return;
    }

    clearSelection();
  }

  function restart(): void {
    aiRequestId++; // invalidate any in-flight AI reply
    pendingAi = null;
    game = new ChessGame();
    busy = false;
    clearSelection();
    rebuildPieceMeshes();
    syncUiAfterMove();
  }

  function undo(): void {
    if (busy || game.turn !== HUMAN_COLOR) return;
    aiRequestId++;
    pendingAi = null;
    // Roll back to the human's previous turn: the AI's reply plus our move.
    game.undo();
    if (game.turn !== HUMAN_COLOR) game.undo();
    clearSelection();
    rebuildPieceMeshes();
    syncUiAfterMove();
  }

  const ui = createUi({
    onDifficultyChange(level) {
      difficulty = level;
      restart();
    },
    onUndo() {
      undo();
    },
    onRestart() {
      restart();
    },
    onToggleView() {
      toggleView();
    },
    onCoachEnabledChange(enabled) {
      coachEnabled = enabled;
      ui.setCoachSettings(coachEnabled, blunderWarnEnabled);
      persist();
      if (enabled) requestCoachAnalysis();
      else {
        hintMove = null;
        latestCoach = null;
        refreshView();
      }
    },
    onBlunderWarnChange(enabled) {
      blunderWarnEnabled = enabled;
      persist();
    },
    onCoachPanelOpened() {
      if (!coachEnabled) return;
      if (latestCoach) pushCoachAdvice();
      else requestCoachAnalysis();
    },
    onHintRevealed(shown, move) {
      hintMove = shown ? move : null;
      refreshView();
    },
  });

  setupPicking(
    sceneRefs.renderer,
    sceneRefs.camera,
    () => [...tiles, ...(sceneRefs.pieceGroup.children as THREE.Object3D[])],
    (square) => void handlePick(square),
  );

  /** Replay a stored game so play resumes exactly where it was left off. */
  function restoreSavedGame(): void {
    const saved = loadGame();
    if (!saved) return;
    difficulty = saved.difficulty;
    ui.setDifficulty(saved.difficulty);
    if (saved.view === '2d' || saved.view === '3d') viewMode = saved.view;
    coachEnabled = saved.coach === true;
    blunderWarnEnabled = saved.blunderWarn === true;
    ui.setCoachSettings(coachEnabled, blunderWarnEnabled);
    for (const move of saved.moves) {
      try {
        game.move(move);
      } catch {
        break; // corrupt tail — keep whatever replayed cleanly
      }
    }
  }

  setRenderLoopActive = startRenderLoop(sceneRefs);

  restoreSavedGame();
  ui.setCoachSettings(coachEnabled, blunderWarnEnabled);
  rebuildPieceMeshes();
  syncUiAfterMove();
  applyViewMode();

  // If the tab was closed on the AI's turn, let it move now.
  if (game.outcome().type === 'in-progress' && game.turn === AI_COLOR) {
    requestAiMove();
  }
}
