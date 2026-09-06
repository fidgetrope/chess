import type { DifficultyLevel } from '../ai/difficulty.ts';
import type { PieceSymbol, ViewMode } from './types.ts';

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
  coach?: boolean;
  blunderWarn?: boolean;
  savedAt: number;
}

export function saveGame(state: {
  moves: SavedMove[];
  difficulty: DifficultyLevel;
  view: ViewMode;
  coach: boolean;
  blunderWarn: boolean;
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
