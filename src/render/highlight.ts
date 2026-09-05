import * as THREE from 'three';
import type { MoveOption } from '../core/types.ts';
import { squareToGrid } from '../core/game.ts';
import { BOARD_TOP_Y, squareToWorld } from './coords.ts';

const MARKER_Y = BOARD_TOP_Y + 0.02; // just above the tile surface, avoids z-fighting

const selectionGeometry = new THREE.RingGeometry(0.4, 0.49, 40);
const selectionMaterial = new THREE.MeshBasicMaterial({
  color: 0xffd54a,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.95,
});

const moveDotGeometry = new THREE.CircleGeometry(0.14, 24);
const moveDotMaterial = new THREE.MeshBasicMaterial({
  color: 0x5adf6b,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});

const captureRingGeometry = new THREE.RingGeometry(0.34, 0.46, 32);
const captureRingMaterial = new THREE.MeshBasicMaterial({
  color: 0xff6b5e,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});

const checkRingGeometry = new THREE.RingGeometry(0.42, 0.52, 40);
const checkRingMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3b30,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.9,
});

function flatMarkerAt(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  row: number,
  col: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  const { x, z } = squareToWorld(row, col);
  mesh.position.set(x, MARKER_Y, z);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export interface HighlightState {
  /** Grid square of the currently selected piece, if any. */
  selected: { row: number; col: number } | null;
  /** Legal moves from the selected piece. */
  moves: MoveOption[];
  /** King square to ring in red when the side to move is in check. */
  checkSquare: { row: number; col: number } | null;
}

/**
 * Replaces the contents of `highlightGroup`: a ring on the selected
 * square, a dot on each quiet destination, a red ring on each capturable
 * destination, and a red ring on a king that is in check.
 */
export function updateHighlights(highlightGroup: THREE.Group, state: HighlightState): void {
  highlightGroup.clear();

  if (state.checkSquare) {
    highlightGroup.add(
      flatMarkerAt(checkRingGeometry, checkRingMaterial, state.checkSquare.row, state.checkSquare.col),
    );
  }

  if (state.selected) {
    highlightGroup.add(
      flatMarkerAt(selectionGeometry, selectionMaterial, state.selected.row, state.selected.col),
    );
  }

  for (const move of state.moves) {
    const { row, col } = squareToGrid(move.to);
    if (move.isCapture) {
      highlightGroup.add(flatMarkerAt(captureRingGeometry, captureRingMaterial, row, col));
    } else {
      highlightGroup.add(flatMarkerAt(moveDotGeometry, moveDotMaterial, row, col));
    }
  }
}
