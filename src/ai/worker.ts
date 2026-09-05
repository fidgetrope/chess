/// <reference lib="webworker" />
import { chooseAiMove, DIFFICULTIES, type DifficultyLevel } from './difficulty.ts';

export interface AiRequest {
  requestId: number;
  fen: string;
  difficulty: DifficultyLevel;
}

export interface AiResponse {
  requestId: number;
  move: { from: string; to: string; promotion?: string; san: string } | null;
}

/**
 * Runs the minimax search off the main thread so a multi-second "Hard"
 * search never freezes the board or its animations. The controller posts
 * an AiRequest; this replies with the chosen move.
 */
self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { requestId, fen, difficulty } = event.data;
  const config = DIFFICULTIES[difficulty] ?? DIFFICULTIES.medium;
  const move = chooseAiMove(fen, config);
  const response: AiResponse = { requestId, move };
  self.postMessage(response);
};
