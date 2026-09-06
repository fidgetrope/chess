import { isMateScore } from './minimax.ts';

/**
 * A one-line standing — but only when the position is *clearly* decided.
 * The engine's positional judgement is too rough to trust for "slightly
 * better / slightly worse", so anything inside a few pawns says nothing.
 *
 * `youCp` is the evaluation from the player's point of view (positive =
 * good for the player).
 */
export function standingWords(youCp: number): string | null {
  if (isMateScore(youCp)) {
    return youCp > 0
      ? 'You have a forced mate here — look for the checks.'
      : 'The AI has a forced mate coming. Look for a check or a swindle.';
  }
  if (youCp >= 500) return "You're winning comfortably — trade pieces and keep it simple.";
  if (youCp >= 350) return "You're clearly better here.";
  if (youCp <= -500) return "You're in real trouble — go looking for tactics and complications.";
  if (youCp <= -350) return "You're worse — play solidly and wait for your chance.";
  return null;
}
