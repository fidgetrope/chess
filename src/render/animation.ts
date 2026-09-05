import * as THREE from 'three';
import type { Square } from '../core/types.ts';
import { PIECE_BASE_Y, squareToWorld } from './coords.ts';

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Drives a value from `from` to `to` over `durationMs` via
 * requestAnimationFrame, calling `onUpdate` each frame with an eased
 * value. No external tween library — this is all a game like this needs.
 */
export function animateValue(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now: number): void {
      const t = Math.min(1, (now - start) / durationMs);
      onUpdate(lerp(from, to, easeInOutSine(t)));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

/**
 * Slides a piece from one square to another. Knights lift into a clear
 * arc (they "jump"); every other piece glides low across the board.
 */
export async function animateMove(
  piece: THREE.Object3D,
  from: Square,
  to: Square,
  options: { arcHeight?: number; durationMs?: number } = {},
): Promise<void> {
  const { arcHeight = 0.15, durationMs = 340 } = options;
  const fromPos = squareToWorld(from.row, from.col);
  const toPos = squareToWorld(to.row, to.col);
  await animateValue(0, 1, durationMs, (t) => {
    piece.position.x = lerp(fromPos.x, toPos.x, t);
    piece.position.z = lerp(fromPos.z, toPos.z, t);
    piece.position.y = PIECE_BASE_Y + Math.sin(Math.PI * t) * arcHeight;
  });
  piece.position.set(toPos.x, PIECE_BASE_Y, toPos.z);
}

/** Sinks and shrinks a captured piece away. Caller removes it from the scene afterward. */
export async function animateCapture(piece: THREE.Object3D, durationMs = 220): Promise<void> {
  const startY = piece.position.y;
  await animateValue(1, 0, durationMs, (s) => {
    piece.scale.setScalar(Math.max(0.001, s));
    piece.position.y = lerp(startY, startY - 0.3, 1 - s);
  });
}

/** A brief pop as a promoted piece appears in place of the pawn. */
export async function animatePromotionReveal(piece: THREE.Object3D, durationMs = 260): Promise<void> {
  await animateValue(0, 1, durationMs, (s) => {
    piece.scale.setScalar(s);
  });
  piece.scale.setScalar(1);
}
