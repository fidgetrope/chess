import type { DifficultyLevel } from '../ai/difficulty.ts';
import type { Color, PieceSymbol, ViewMode } from './types.ts';

// Continuous play: the in-progress game is written to localStorage after
// every move, so closing the tab and coming back later resumes the exact
// position (same as the Cat Cat game). Stored as the list of moves rather
// than a FEN/PGN blob so it replays through the identical `ChessGame.move`
// path — move history, threefold-repetition state and undo all reconstruct
// for free.

const STORAGE_KEY = 'chess.save.v1';

export interface SavedMove {
  from: string;
  to: string;
  promotion?: PieceSymbol;
}

export interface SavedGame {
  v: 1;
  moves: SavedMove[];
  difficulty: DifficultyLevel;
  view?: ViewMode;
  /** "Explain moves I can't make" — absent means on (opt-out). */
  explainMoves?: boolean;
  savedAt: number;
}

export function saveGame(state: {
  moves: SavedMove[];
  difficulty: DifficultyLevel;
  view: ViewMode;
  explainMoves: boolean;
}): void {
  try {
    const payload: SavedGame = { v: 1, savedAt: Date.now(), ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private mode, quota, disabled) — non-fatal.
  }
}

export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (parsed?.v !== 1 || !Array.isArray(parsed.moves)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// "Play a friend" games live in Firestore, not localStorage — this is just
// a pointer ("I'm in game X as color Y") so reopening the tab reconnects,
// kept deliberately separate from the solo save above so a multiplayer
// game never overwrites (or is overwritten by) the solo one.

const MULTIPLAYER_KEY = 'chess.multiplayer.v1';

export interface MultiplayerPointer {
  gameId: string;
  color: Color;
}

export function saveMultiplayerPointer(pointer: MultiplayerPointer): void {
  try {
    localStorage.setItem(MULTIPLAYER_KEY, JSON.stringify(pointer));
  } catch {
    // Storage unavailable — non-fatal; the game still works, it just won't reconnect on reload.
  }
}

export function loadMultiplayerPointer(): MultiplayerPointer | null {
  try {
    const raw = localStorage.getItem(MULTIPLAYER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MultiplayerPointer;
    if (typeof parsed?.gameId !== 'string' || (parsed.color !== 'white' && parsed.color !== 'black')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearMultiplayerPointer(): void {
  try {
    localStorage.removeItem(MULTIPLAYER_KEY);
  } catch {
    // non-fatal
  }
}
