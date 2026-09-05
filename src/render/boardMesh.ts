import * as THREE from 'three';
import type { Square } from '../core/types.ts';
import { squareToWorld, TILE_HEIGHT, TILE_SIZE } from './coords.ts';

const LIGHT_SQUARE = 0xe8d3ae; // cream
const DARK_SQUARE = 0x8a5a3c; // walnut
const FRAME_COLOR = 0x3c2a1c;
const FELT_COLOR = 0x241a12;

export interface TileMesh extends THREE.Mesh {
  userData: { square: Square };
}

/** A light or dark square is light when (row + col) is even (a1 is dark). */
function isLightSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

/**
 * Builds the 8x8 board (every square rendered), a contrasting border frame
 * around it, and a low plinth underneath — the frame is what makes the
 * grid read as a chess set rather than a checkerboard pattern.
 */
export function buildBoardMeshes(group: THREE.Group): TileMesh[] {
  const geometry = new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE);
  const lightMaterial = new THREE.MeshStandardMaterial({ color: LIGHT_SQUARE, roughness: 0.55, metalness: 0.05 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: DARK_SQUARE, roughness: 0.55, metalness: 0.05 });

  const tiles: TileMesh[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const light = isLightSquare(row, col);
      const mesh = new THREE.Mesh(geometry, light ? lightMaterial : darkMaterial) as unknown as TileMesh;
      const { x, z } = squareToWorld(row, col);
      mesh.position.set(x, 0, z);
      mesh.receiveShadow = true;
      mesh.userData = { square: { row, col } };
      group.add(mesh);
      tiles.push(mesh);
    }
  }

  // Border frame: four bars framing the 8x8 field.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.5, metalness: 0.1 });
  const frameWidth = 0.7;
  const frameHeight = TILE_HEIGHT * 1.05;
  const span = TILE_SIZE * 8 + frameWidth * 2;
  const frameY = -0.01;
  const bars: Array<[number, number, number, number]> = [
    // [sizeX, sizeZ, posX, posZ]
    [span, frameWidth, 0, -TILE_SIZE * 4 - frameWidth / 2],
    [span, frameWidth, 0, TILE_SIZE * 4 + frameWidth / 2],
    [frameWidth, TILE_SIZE * 8, -TILE_SIZE * 4 - frameWidth / 2, 0],
    [frameWidth, TILE_SIZE * 8, TILE_SIZE * 4 + frameWidth / 2, 0],
  ];
  for (const [sx, sz, px, pz] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, frameHeight, sz), frameMaterial);
    bar.position.set(px, frameY, pz);
    bar.castShadow = true;
    bar.receiveShadow = true;
    group.add(bar);
  }

  // Plinth / underside so the board has visual weight from a low angle.
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(span + 0.5, TILE_HEIGHT * 0.9, span + 0.5),
    new THREE.MeshStandardMaterial({ color: FELT_COLOR, roughness: 0.9 }),
  );
  plinth.position.set(0, -TILE_HEIGHT * 0.7, 0);
  plinth.receiveShadow = true;
  group.add(plinth);

  return tiles;
}
