import * as THREE from 'three';
import AiWorker from '../ai/worker.ts?worker';
import type { AiRequest, AiResponse } from '../ai/worker.ts';
import CoachWorker from '../ai/coachWorker.ts?worker';
import type { CoachRequest, CoachResponse } from '../ai/coachWorker.ts';
import type { DifficultyLevel } from '../ai/difficulty.ts';
import { ChessGame, opponentOf, squareToGrid } from '../core/game.ts';
import type { MultiplayerSession } from '../multiplayer/multiplayerClient.ts';
import {
  clearMultiplayerPointer,
  loadGame,
  loadMultiplayerPointer,
  saveGame,
  saveMultiplayerPointer,
  type SavedMove,
} from '../core/persistence.ts';
import type { Color, MoveOption, PieceSymbol, Square, ViewMode } from '../core/types.ts';
import { animateCapture, animateMove, animatePromotionReveal } from '../render/animation.ts';
import { createBoard2d } from '../render/board2d.ts';
import { buildBoardMeshes, type TileMesh } from '../render/boardMesh.ts';
import { updateHighlights } from '../render/highlight.ts';
import { setupPicking } from '../render/picking.ts';
import { createPieceMesh, type PieceMesh } from '../render/pieceMesh.ts';
import { createScene, startRenderLoop } from '../render/scene.ts';
import { createUi } from '../ui/ui.ts';

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

  // Which colour *this* browser is playing. Always white against the AI;
  // in a "Play a friend" game it's whichever seat this browser took.
  let myColor: Color = 'white';

  // Rules helper (opt-out): explain why a tapped move isn't legal.
  let explainMovesEnabled = true;
  let rejectedSquare: Square | null = null;
  let rulesNoteTimer: number | null = null;
  let aiRequestId = 0;
  let pendingAi: { requestId: number; startedAt: number } | null = null;
  let setRenderLoopActive: (active: boolean) => void = () => {};

  // "Play a friend" (opt-in): when set, the opponent's moves arrive over
  // Firestore instead of from the AI worker, and our own moves are pushed
  // out after being applied locally exactly like any other move.
  let mpSession: MultiplayerSession | null = null;
  let mpUnsubscribe: (() => void) | null = null;

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

  /**
   * The played move list in SavedMove shape. `promotion` is *omitted*, not
   * set to undefined, for non-promoting moves — Firestore's SDK rejects any
   * field explicitly valued `undefined` (JSON.stringify silently drops it,
   * which is why this distinction never mattered for the solo save before).
   */
  function historyAsSavedMoves(): SavedMove[] {
    return game.detailedHistory().map((m) =>
      m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to },
    );
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
        rejectedSquare,
      });
    } else {
      board2d.render({
        board: game.board(),
        selected,
        moves: legalFromSelected,
        checkSquare,
        lastMove: lastMovePair(),
        hintMove,
        rejectedSquare,
      });
    }
  }

  // ---- Rules helper --------------------------------------------------------

  function clearRulesNote(): void {
    if (rulesNoteTimer !== null) {
      clearTimeout(rulesNoteTimer);
      rulesNoteTimer = null;
    }
    ui.setRulesNote(null);
    if (rejectedSquare) {
      rejectedSquare = null;
      refreshView();
    }
  }

  function showRulesNote(reason: string): void {
    ui.setRulesNote(reason);
    if (rulesNoteTimer !== null) clearTimeout(rulesNoteTimer);
    rulesNoteTimer = window.setTimeout(() => {
      rulesNoteTimer = null;
      ui.setRulesNote(null);
      rejectedSquare = null;
      refreshView();
    }, 4500);
  }

  /** Show why the tapped square isn't a legal destination. Returns whether a note was shown. */
  function explainRejectedMove(from: Square, to: Square): boolean {
    const reason = game.explainIllegalMove(squareKey(from), squareKey(to));
    if (!reason) return false;
    rejectedSquare = to;
    showRulesNote(reason);
    refreshView();
    return true;
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
      game.turn !== myColor ||
      game.outcome().type !== 'in-progress'
    ) {
      return;
    }
    const requestId = ++coachRequestId;
    if (ui.isCoachPanelOpen()) ui.setCoachThinking();
    getCoachWorker().postMessage({
      requestId,
      fen: game.fen(),
      humanColor: myColor,
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
        humanColor: myColor,
        mode: 'blunderCheck',
        move: { from: move.from, to: move.to, promotion: move.promotion },
      } satisfies CoachRequest);
    });
  }

  function blunderPhrase(verdict: NonNullable<CoachResponse['blunder']>): string {
    if (verdict.intoMate) return 'walks into a forced mate';
    if (verdict.dropCp >= 300) return 'looks like it drops a piece';
    return 'looks like it loses material';
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
    const byMe: PieceSymbol[] = [];
    const byOpponent: PieceSymbol[] = [];
    // White plays plies 0, 2, 4…; the captured man is the opposite colour
    // to whoever moved on that ply.
    game.detailedHistory().forEach((move, ply) => {
      if (!move.captured) return;
      const mover: Color = ply % 2 === 0 ? 'white' : 'black';
      (mover === myColor ? byMe : byOpponent).push(move.captured);
    });
    ui.setCaptured(byMe, byOpponent, myColor);
  }

  function updateStatusUi(): void {
    const outcome = game.outcome();
    if (outcome.type !== 'in-progress') {
      ui.setTurn('Game over');
      ui.setCheck(false);
      ui.showGameOver(outcome, myColor, mpSession ? 'your opponent' : 'the AI');
      return;
    }
    ui.hideGameOver();
    const myTurn = game.turn === myColor;
    ui.setTurn(myTurn ? 'Your turn' : mpSession ? 'Waiting for them…' : 'AI thinking…');
    ui.setCheck(game.inCheck());
  }

  /** Multiplayer state lives in Firestore, not localStorage — only solo games use the save slot. */
  function persist(): void {
    if (mpSession) return;
    saveGame({
      moves: historyAsSavedMoves(),
      difficulty,
      view: viewMode,
      coach: coachEnabled,
      blunderWarn: blunderWarnEnabled,
      explainMoves: explainMovesEnabled,
    });
  }

  /** Swap the on-screen board, pausing the WebGL loop while the flat board covers it. */
  function applyViewMode(): void {
    clearRulesNote();
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
    clearRulesNote();
    ui.setMoveList(game.history());
    updateCapturedUi();
    ui.setUndoEnabled(!mpSession && !busy && game.plyCount() > 0 && game.turn === myColor);
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

    // Solo: ask the worker for the AI's reply. Multiplayer: nothing to do —
    // the opponent's move arrives on its own over the Firestore listener.
    if (!mpSession && game.outcome().type === 'in-progress' && game.turn === opponentOf(myColor)) {
      requestAiMove();
    }
  }

  /** Applies every move beyond what we've already played, one at a time (animated, like the AI's reply). */
  async function applyRemoteMoves(remoteMoves: SavedMove[]): Promise<void> {
    while (game.plyCount() < remoteMoves.length) {
      const next = remoteMoves[game.plyCount()];
      const chosen = game
        .legalMoves()
        .find((m) => m.from === next.from && m.to === next.to && m.promotion === next.promotion);
      if (!chosen) break; // shouldn't happen; guards against a corrupt remote document
      await playMove(chosen);
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
    clearRulesNote();
    if (busy || game.outcome().type !== 'in-progress' || game.turn !== myColor) return;
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
        if (mpSession) void mpSession.pushMoves(historyAsSavedMoves());
        return;
      }
    }

    const piece = game.pieceAt(square);
    if (piece && piece.color === myColor) {
      const moves = game.legalMovesFrom(square);
      if (moves.length === 0) {
        const reason = explainMovesEnabled ? game.explainNoMoves(squareKey(square)) : null;
        if (reason) {
          selected = square; // show it picked, with no options, alongside the note
          legalFromSelected = [];
          showRulesNote(reason);
          refreshView();
          return;
        }
        clearSelection();
        return;
      }
      selected = square;
      legalFromSelected = moves;
      refreshView();
      return;
    }

    // A piece is up and the player tapped an empty square or an enemy piece
    // that isn't a legal target: say why, and keep the selection so they can
    // try elsewhere.
    if (selected && explainMovesEnabled && explainRejectedMove(selected, square)) {
      return;
    }

    clearSelection();
  }

  /** Starts a fresh solo game. No-op mid multiplayer game — use "Leave game" instead. */
  function restart(): void {
    if (mpSession) return;
    aiRequestId++; // invalidate any in-flight AI reply
    pendingAi = null;
    game = new ChessGame();
    busy = false;
    clearSelection();
    rebuildPieceMeshes();
    syncUiAfterMove();
  }

  function undo(): void {
    if (mpSession || busy || game.turn !== myColor) return;
    aiRequestId++;
    pendingAi = null;
    // Roll back to the human's previous turn: the AI's reply plus our move.
    game.undo();
    if (game.turn !== myColor) game.undo();
    clearSelection();
    rebuildPieceMeshes();
    syncUiAfterMove();
  }

  // ---- "Play a friend" -------------------------------------------------

  function isChunkLoadError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /dynamically imported module|loading chunk|importing a module script failed/i.test(message);
  }

  function friendlyMpError(err: unknown): string {
    if (isChunkLoadError(err)) {
      return "Couldn't load — that's usually just a shaky connection. Check you're online and try again.";
    }
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code.includes('permission-denied')) {
      return "Couldn't connect — the Firestore rules might not be published yet.";
    }
    if (err instanceof Error && err.message) return err.message;
    return 'Something went wrong connecting. Please try again.';
  }

  /**
   * Loads the multiplayer module, retrying once after a short pause if the
   * chunk fetch fails — a mobile network blip is common and the browser's
   * own dynamic import() has no built-in retry, so the first hiccup would
   * otherwise always surface as an error even though trying again works.
   */
  async function loadMultiplayerClient(): Promise<typeof import('../multiplayer/multiplayerClient.ts')> {
    try {
      return await import('../multiplayer/multiplayerClient.ts');
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800));
      return import('../multiplayer/multiplayerClient.ts');
    }
  }

  /**
   * Rotates the 3D board+pieces 180° (and mirrors the 2D grid) so whichever
   * colour `myColor` is playing sits nearest the camera / at the bottom of
   * the screen — the camera and the room stay exactly where they are, only
   * the board+pieces groups turn, the same as walking round to the other
   * side of a real table. Picking needs no changes: each tile/piece mesh
   * reports its own logical square via userData regardless of the group's
   * transform, and Three.js raycasts against the current world transform.
   */
  function applyBoardOrientation(): void {
    const flipped = myColor === 'black';
    const yaw = flipped ? Math.PI : 0;
    sceneRefs.boardGroup.rotation.y = yaw;
    sceneRefs.pieceGroup.rotation.y = yaw;
    sceneRefs.highlightGroup.rotation.y = yaw;
    board2d.setOrientation(flipped);
  }

  /** Loads a fully-seated or waiting session into the game and starts listening for opponent moves. */
  function enterMultiplayer(session: MultiplayerSession): void {
    mpUnsubscribe?.();
    mpSession = session;
    myColor = session.color;
    applyBoardOrientation();
    aiRequestId++; // invalidate any in-flight solo AI reply
    pendingAi = null;

    game = new ChessGame();
    for (const move of session.initialMoves) {
      try {
        game.move(move);
      } catch {
        break; // corrupt remote document — keep whatever replayed cleanly
      }
    }

    saveMultiplayerPointer({ gameId: session.gameId, color: session.color });
    ui.setOpponentLabel('Opponent');
    ui.setMultiplayerPanel(
      session.opponentJoined
        ? { phase: 'active', color: myColor }
        : { phase: 'waiting', gameId: session.gameId, shareUrl: session.shareUrl },
    );

    mpUnsubscribe = session.subscribe((moves, opponentJoined) => {
      if (opponentJoined && mpSession === session) {
        ui.setMultiplayerPanel({ phase: 'active', color: myColor });
      }
      void applyRemoteMoves(moves);
    });

    busy = false;
    clearSelection();
    rebuildPieceMeshes();
    syncUiAfterMove();
  }

  async function startMultiplayerCreate(hostColor: Color | 'random'): Promise<void> {
    ui.setMultiplayerPanel({ phase: 'creating' });
    try {
      const { createGame } = await loadMultiplayerClient();
      enterMultiplayer(await createGame(hostColor));
    } catch (err) {
      ui.setMultiplayerPanel({ phase: 'error', message: friendlyMpError(err) });
    }
  }

  /** Accepts a bare game code or a pasted invite link. */
  function extractGameCode(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const fromUrl = new URL(trimmed).searchParams.get('game');
      if (fromUrl) return fromUrl.toUpperCase();
    } catch {
      // not a URL — fall through and treat the whole thing as a bare code
    }
    return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  }

  async function startMultiplayerJoin(rawCode: string): Promise<void> {
    const code = extractGameCode(rawCode);
    if (!code) {
      ui.setMultiplayerPanel({ phase: 'error', message: "That doesn't look like a game code." });
      return;
    }
    ui.setMultiplayerPanel({ phase: 'joining' });
    try {
      const { joinGame } = await loadMultiplayerClient();
      enterMultiplayer(await joinGame(code));
    } catch (err) {
      ui.setMultiplayerPanel({ phase: 'error', message: friendlyMpError(err) });
    }
  }

  /** On load: reconnect to a game this browser already had a seat in. */
  async function reconnectMultiplayer(): Promise<void> {
    const pointer = loadMultiplayerPointer();
    if (!pointer) return;
    ui.setMultiplayerPanel({ phase: 'joining' });
    try {
      const { rejoinGame } = await loadMultiplayerClient();
      enterMultiplayer(await rejoinGame(pointer.gameId, pointer.color));
    } catch (err) {
      // A network blip shouldn't cost the player their seat — only give up
      // the pointer once we get an actual answer that says the game/seat is gone.
      if (!isChunkLoadError(err)) clearMultiplayerPointer();
      ui.setMultiplayerPanel({ phase: 'error', message: friendlyMpError(err) });
    }
  }

  function leaveMultiplayer(): void {
    mpUnsubscribe?.();
    mpUnsubscribe = null;
    mpSession = null;
    clearMultiplayerPointer();
    myColor = 'white';
    applyBoardOrientation();
    ui.setOpponentLabel('AI');
    ui.setMultiplayerPanel({ phase: 'idle' });
    restart();
  }

  const ui = createUi({
    onDifficultyChange(level) {
      if (mpSession) return;
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
      ui.setCoachSettings(coachEnabled, blunderWarnEnabled, explainMovesEnabled);
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
    onExplainMovesChange(enabled) {
      explainMovesEnabled = enabled;
      if (!enabled) clearRulesNote();
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
    onCreateGame(hostColor) {
      void startMultiplayerCreate(hostColor);
    },
    onJoinGame(code) {
      void startMultiplayerJoin(code);
    },
    onLeaveGame() {
      leaveMultiplayer();
    },
    onDismissMultiplayerError() {
      ui.setMultiplayerPanel({ phase: 'idle' });
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
    explainMovesEnabled = saved.explainMoves !== false; // absent → on
    ui.setCoachSettings(coachEnabled, blunderWarnEnabled, explainMovesEnabled);
    for (const move of saved.moves) {
      try {
        game.move(move);
      } catch {
        break; // corrupt tail — keep whatever replayed cleanly
      }
    }
  }

  /** A shared invite link (?game=CODE) — consumed once, then scrubbed from the URL. */
  function consumeGameCodeFromUrl(): string | null {
    const url = new URL(location.href);
    const code = url.searchParams.get('game');
    if (!code) return null;
    url.searchParams.delete('game');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return code;
  }

  setRenderLoopActive = startRenderLoop(sceneRefs);

  // The solo game restores first regardless — it's what's waiting if a
  // multiplayer connection below fails, or once the player leaves one.
  restoreSavedGame();
  ui.setCoachSettings(coachEnabled, blunderWarnEnabled, explainMovesEnabled);
  rebuildPieceMeshes();
  syncUiAfterMove();
  applyViewMode();

  const urlGameCode = consumeGameCodeFromUrl();
  const mpPointer = loadMultiplayerPointer();
  if (urlGameCode) {
    void startMultiplayerJoin(urlGameCode);
  } else if (mpPointer) {
    void reconnectMultiplayer();
  } else if (game.outcome().type === 'in-progress' && game.turn === opponentOf(myColor)) {
    // If the tab was closed on the AI's turn, let it move now.
    requestAiMove();
  }
}
