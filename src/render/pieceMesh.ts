import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { Color, Piece, PieceSymbol, Square } from '../core/types.ts';
import { PIECE_BASE_Y, squareToWorld } from './coords.ts';

export interface PieceMesh extends THREE.Group {
  userData: {
    square: Square;
    color: Color;
    type: PieceSymbol;
  };
}

const REVOLVE_SEGMENTS = 48;

// Two finishes for a "traditional black and white" set: a warm ivory and a
// dark walnut, both with a faint clear-coat sheen so they catch light like
// polished resin rather than looking like flat plastic. Created once and
// shared by every piece instance.
const LIGHT_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xf0e6d2,
  roughness: 0.35,
  metalness: 0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.3,
});
const DARK_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x2a1d14,
  roughness: 0.4,
  metalness: 0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.35,
});

function materialFor(color: Color): THREE.MeshPhysicalMaterial {
  return color === 'white' ? LIGHT_MATERIAL : DARK_MATERIAL;
}

function v(x: number, y: number): THREE.Vector2 {
  return new THREE.Vector2(x, y);
}

/** Points along a circular arc, for the rounded parts of a turned profile. */
function arc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  steps = 8,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    points.push(v(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius));
  }
  return points;
}

/**
 * Shared "turned" base every piece rises from: a flared foot, a chamfer,
 * and a narrow stem. Returned points run from the center of the base (y=0)
 * up to the top of the stem.
 */
function baseProfile(): THREE.Vector2[] {
  return [
    v(0, 0),
    v(0.36, 0),
    v(0.36, 0.06),
    v(0.33, 0.1),
    v(0.24, 0.14),
    v(0.17, 0.22),
    v(0.14, 0.34),
  ];
}

function pawnProfile(): THREE.Vector2[] {
  return [
    ...baseProfile(),
    v(0.16, 0.4),
    v(0.23, 0.44),
    v(0.23, 0.48),
    v(0.12, 0.52),
    v(0.1, 0.56),
    ...arc(0, 0.72, 0.17, -Math.PI / 2, Math.PI / 2, 12),
  ];
}

function rookProfile(): THREE.Vector2[] {
  return [
    ...baseProfile(),
    v(0.15, 0.42),
    v(0.19, 0.46),
    v(0.19, 0.5),
    v(0.16, 0.54),
    v(0.16, 0.62),
    v(0.28, 0.64),
    v(0.3, 0.66),
    v(0.3, 0.78), // battlement rim (merlons added separately)
    v(0.2, 0.78),
    v(0.2, 0.72),
    v(0, 0.72),
  ];
}

function bishopProfile(): THREE.Vector2[] {
  return [
    ...baseProfile(),
    v(0.15, 0.4),
    v(0.23, 0.44),
    v(0.23, 0.48),
    v(0.12, 0.52),
    v(0.11, 0.56),
    // Tapered mitre: swells just above the collar, then narrows to a point.
    v(0.2, 0.63),
    v(0.19, 0.73),
    v(0.15, 0.87),
    v(0.09, 0.99),
    v(0.05, 1.06),
    ...arc(0, 1.11, 0.055, -Math.PI / 2, Math.PI / 2, 8), // small round finial
  ];
}

function queenProfile(): THREE.Vector2[] {
  return [
    ...baseProfile(),
    v(0.17, 0.44),
    v(0.26, 0.48),
    v(0.26, 0.52),
    v(0.14, 0.58),
    v(0.12, 0.66),
    ...arc(0, 0.86, 0.2, -Math.PI / 2, 0, 8), // bowl underside
    v(0.2, 0.9),
    v(0.28, 1.0), // flared coronet base (points added separately)
    v(0.24, 1.04),
    v(0.1, 1.04),
    v(0.08, 1.08),
    ...arc(0, 1.14, 0.08, -Math.PI / 2, Math.PI / 2, 8),
  ];
}

function kingProfile(): THREE.Vector2[] {
  return [
    ...baseProfile(),
    v(0.18, 0.46),
    v(0.27, 0.5),
    v(0.27, 0.54),
    v(0.15, 0.6),
    v(0.13, 0.68),
    ...arc(0, 0.9, 0.21, -Math.PI / 2, 0, 8), // crown bowl
    v(0.21, 0.94),
    v(0.27, 1.02),
    v(0.24, 1.08),
    v(0.13, 1.1),
    v(0.12, 1.16),
    v(0.16, 1.2), // collar the cross sits on
    v(0.1, 1.22),
    v(0, 1.22),
  ];
}

// The knight is a mesh, the bishop is turned-then-booleaned; the rest are
// plain turned profiles.
const LATHE_PROFILES: Record<'p' | 'r' | 'q' | 'k', () => THREE.Vector2[]> = {
  p: pawnProfile,
  r: rookProfile,
  q: queenProfile,
  k: kingProfile,
};

function latheMesh(points: THREE.Vector2[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(points, REVOLVE_SEGMENTS);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Four merlons around the rook's rim so its top reads as a castle turret. */
function addRookMerlons(group: THREE.Group, material: THREE.Material): void {
  const merlon = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  for (let i = 0; i < 4; i++) {
    const block = new THREE.Mesh(merlon, material);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    block.position.set(Math.cos(angle) * 0.22, 0.82, Math.sin(angle) * 0.22);
    block.castShadow = true;
    group.add(block);
  }
}

// The bishop's mitre is turned like the other pieces, then a thin wedge is
// booleaned out of the top third for the traditional diagonal saw-cut. The
// result is a real gap in the geometry (its inner faces catch light like
// the rest of the piece), not a dark decal. Computed once and shared by
// every bishop, since the cut doesn't depend on colour.
let bishopGeometryCache: THREE.BufferGeometry | null = null;

function bishopGeometry(): THREE.BufferGeometry {
  if (bishopGeometryCache) return bishopGeometryCache;

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  const head = new Brush(new THREE.LatheGeometry(bishopProfile(), REVOLVE_SEGMENTS));
  head.updateMatrixWorld();

  const cut = new Brush(new THREE.BoxGeometry(0.7, 0.055, 0.7));
  cut.position.set(0, 0.86, 0);
  cut.rotation.x = -Math.PI * 0.2;
  cut.updateMatrixWorld();

  const result = evaluator.evaluate(head, cut, SUBTRACTION);
  result.geometry.computeVertexNormals();
  bishopGeometryCache = result.geometry;
  return bishopGeometryCache;
}

/** A ring of small spikes topped with beads — the queen's coronet. */
function addQueenCoronet(group: THREE.Group, material: THREE.Material): void {
  const bead = new THREE.SphereGeometry(0.05, 12, 12);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const b = new THREE.Mesh(bead, material);
    b.position.set(Math.cos(angle) * 0.24, 1.02, Math.sin(angle) * 0.24);
    b.castShadow = true;
    group.add(b);
  }
}

/** The cross finial on the king. */
function addKingCross(group: THREE.Group, material: THREE.Material): void {
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.08), material);
  vertical.position.y = 1.34;
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), material);
  horizontal.position.y = 1.36;
  for (const bar of [vertical, horizontal]) {
    bar.castShadow = true;
    group.add(bar);
  }
}

/**
 * The knight is the one piece that can't be turned on a lathe. Built as an
 * extruded side-profile horse head on a chamfered base that matches the
 * height and footprint of the other pieces.
 */
function buildKnight(color: Color): THREE.Group {
  const group = new THREE.Group();
  const material = materialFor(color);

  // Base, echoing the lathed pieces' feet.
  const base = latheMesh(
    [
      v(0, 0),
      v(0.36, 0),
      v(0.36, 0.06),
      v(0.33, 0.1),
      v(0.24, 0.14),
      v(0.2, 0.2),
      v(0.19, 0.3),
      v(0.17, 0.36),
      v(0, 0.36),
    ],
    material,
  );
  group.add(base);

  // Horse-head silhouette in the x/y plane, extruded along z.
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, 0.32);
  shape.lineTo(-0.2, 0.5);
  shape.lineTo(-0.16, 0.74);
  shape.lineTo(-0.05, 0.9);
  shape.lineTo(-0.1, 1.02); // ear back
  shape.lineTo(0.03, 0.98);
  shape.lineTo(0.06, 1.05); // ear front
  shape.lineTo(0.16, 0.92);
  shape.lineTo(0.24, 0.78);
  shape.lineTo(0.34, 0.66); // brow
  shape.lineTo(0.36, 0.54); // muzzle top
  shape.lineTo(0.3, 0.46);
  shape.lineTo(0.16, 0.44); // nostril underside
  shape.lineTo(0.06, 0.5);
  shape.lineTo(-0.02, 0.42);
  shape.lineTo(0.05, 0.34);
  shape.lineTo(-0.16, 0.32);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    steps: 1,
  });
  geometry.center();
  geometry.translate(0, 0.66, 0);

  const head = new THREE.Mesh(geometry, material);
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  return group;
}

/** Builds a full piece: a turned body (or the knight mesh) plus any finial detail. */
export function createPieceMesh(square: Square, piece: Piece): PieceMesh {
  const group = new THREE.Group() as PieceMesh;
  const material = materialFor(piece.color);

  if (piece.type === 'n') {
    const knight = buildKnight(piece.color);
    // The head silhouette is modelled with its muzzle toward +x; turn it to
    // face down the board at the opponent (White toward +z, Black toward -z).
    knight.rotation.y = piece.color === 'white' ? -Math.PI / 2 : Math.PI / 2;
    group.add(knight);
  } else if (piece.type === 'b') {
    const body = new THREE.Mesh(bishopGeometry(), material);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
  } else {
    const body = latheMesh(LATHE_PROFILES[piece.type](), material);
    group.add(body);
    if (piece.type === 'r') addRookMerlons(group, material);
    if (piece.type === 'q') addQueenCoronet(group, material);
    if (piece.type === 'k') addKingCross(group, material);
  }

  const { x, z } = squareToWorld(square.row, square.col);
  group.position.set(x, PIECE_BASE_Y, z);
  group.userData = { square, color: piece.color, type: piece.type };
  return group;
}
