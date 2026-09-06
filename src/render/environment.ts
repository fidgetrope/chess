import * as THREE from 'three';

// A cosy English-study backdrop built the same way as everything else here:
// plain Three.js primitives, no imported art. It stays deliberately muted —
// dark walls, warm lamp + fire glow, and distance fog — so it adds depth
// and interest without pulling focus from the board.

const BG_COLOR = 0x211910;

const BOOK_PALETTE = [
  0x6e2b2b, // burgundy
  0x33472f, // forest green
  0x2b3850, // navy
  0x8a6a2f, // gilt / mustard
  0x795b3d, // tan leather
  0x47201f, // oxblood
  0x3b3f44, // slate
  0xb4a480, // aged cream
];

const unitBox = new THREE.BoxGeometry(1, 1, 1);

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(px, py, pz);
  return mesh;
}

/**
 * Fills a bookcase frame (added to `group` in its local frame, open side
 * facing -z) with rows of books, pushing each book's world matrix into
 * `buckets` keyed by colour so they can be drawn as a handful of
 * InstancedMeshes rather than hundreds of meshes.
 */
function shelveBooks(
  frame: THREE.Object3D,
  buckets: Map<number, THREE.Matrix4[]>,
  cfg: { width: number; height: number; depth: number; panel: number; shelves: number; rng: () => number },
): void {
  frame.updateWorldMatrix(true, false);
  const { width: W, height: H, depth: D, panel: t, shelves, rng } = cfg;
  const inner = H - 2 * t;
  const gap = inner / shelves;

  const scratch = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  for (let s = 0; s < shelves; s++) {
    const yBase = -H / 2 + t + s * gap;
    const rowH = gap - t;
    let x = -W / 2 + t + 0.2;
    const xEnd = W / 2 - t - 0.2;
    while (x < xEnd) {
      if (rng() < 0.05) {
        x += 0.25 + rng() * 0.6; // a gap in the row
        continue;
      }
      const bw = 0.24 + rng() * 0.32;
      if (x + bw > xEnd) break;
      const bh = rowH * (0.66 + rng() * 0.3);
      const bd = D * (0.55 + rng() * 0.32);
      const lean = rng() < 0.07 ? (rng() - 0.5) * 0.4 : 0;
      const color = BOOK_PALETTE[(rng() * BOOK_PALETTE.length) | 0];

      pos.set(x + bw / 2, yBase + bh / 2 + 0.02, D / 2 - t - bd / 2 - 0.06);
      euler.set(0, 0, lean);
      quat.setFromEuler(euler);
      scl.set(bw, bh, bd);
      scratch.compose(pos, quat, scl).premultiply(frame.matrixWorld);

      let bucket = buckets.get(color);
      if (!bucket) buckets.set(color, (bucket = []));
      bucket.push(scratch.clone());

      x += bw + 0.02;
    }
  }
}

function buildBookcase(
  buckets: Map<number, THREE.Matrix4[]>,
  wood: THREE.Material,
  cfg: { width: number; height: number; center: THREE.Vector3; rotationY: number; shelves: number; rng: () => number },
): THREE.Group {
  const depth = 1.4;
  const t = 0.22;
  const { width: W, height: H } = cfg;

  const frame = new THREE.Group();
  frame.position.copy(cfg.center);
  frame.rotation.y = cfg.rotationY;

  frame.add(box(wood, t, H, depth, -W / 2 + t / 2, 0, 0));
  frame.add(box(wood, t, H, depth, W / 2 - t / 2, 0, 0));
  frame.add(box(wood, W, t, depth, 0, H / 2 - t / 2, 0));
  frame.add(box(wood, W, t, depth, 0, -H / 2 + t / 2, 0));
  frame.add(box(wood, W, H, t, 0, 0, depth / 2 - t / 2)); // back panel

  const inner = H - 2 * t;
  const gap = inner / cfg.shelves;
  for (let i = 1; i < cfg.shelves; i++) {
    frame.add(box(wood, W - 2 * t, t, depth - t, 0, -H / 2 + t + i * gap, 0));
  }

  shelveBooks(frame, buckets, { width: W, height: H, depth, panel: t, shelves: cfg.shelves, rng: cfg.rng });
  return frame;
}

function buildFireplace(root: THREE.Group, stone: THREE.Material): void {
  // On the left wall, opening facing +x (into the room).
  const group = new THREE.Group();
  group.position.set(-29.3, 0, -3);

  const surroundMat = stone;
  group.add(box(surroundMat, 1.2, 6.4, 5.2, 0, 3.2 - 0.4, 0)); // slab behind
  group.add(box(surroundMat, 1.0, 6.4, 0.9, 0, 3.2 - 0.4, 2.4)); // right jamb
  group.add(box(surroundMat, 1.0, 6.4, 0.9, 0, 3.2 - 0.4, -2.4)); // left jamb
  group.add(box(surroundMat, 1.0, 0.9, 5.2, 0, 6.0 - 0.4, 0)); // lintel
  const mantel = box(new THREE.MeshStandardMaterial({ color: 0x3a2a1b, roughness: 0.7 }), 1.6, 0.4, 6.2, 0.1, 6.6 - 0.4, 0);
  group.add(mantel);

  // Fire box + embers.
  group.add(box(new THREE.MeshStandardMaterial({ color: 0x0d0906, roughness: 1 }), 0.6, 3.6, 3.6, 0.35, 1.6, 0));
  const ember = box(
    new THREE.MeshStandardMaterial({ color: 0xff6a1e, emissive: 0xff5a12, emissiveIntensity: 1.6, roughness: 1 }),
    0.3,
    1.0,
    2.6,
    0.5,
    0.6,
    0,
  );
  group.add(ember);

  const glow = new THREE.PointLight(0xff7a2e, 4.5, 60, 2);
  glow.position.set(-26.5, 1.8, -3);
  root.add(glow);

  root.add(group);
}

function buildPainting(root: THREE.Group): void {
  // Framed landscape on the right wall, facing -x.
  const group = new THREE.Group();
  group.position.set(29.5, 5.6, 4);
  group.rotation.y = -Math.PI / 2;

  group.add(box(new THREE.MeshStandardMaterial({ color: 0x6b501f, roughness: 0.6, metalness: 0.3 }), 4.6, 3.4, 0.25, 0, 0, 0));
  group.add(box(new THREE.MeshStandardMaterial({ color: 0x243024, roughness: 0.9 }), 4.0, 2.8, 0.28, 0, 0, 0.02)); // dark ground
  group.add(box(new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.9 }), 4.0, 1.0, 0.3, 0, -0.7, 0.03)); // hills
  group.add(box(new THREE.MeshStandardMaterial({ color: 0x8f7a3e, roughness: 0.8, emissive: 0x2a2010, emissiveIntensity: 0.5 }), 0.5, 0.5, 0.32, -1.1, 0.7, 0.04)); // moon

  root.add(group);
}

/** Builds the whole study around the origin and adds it to the scene. */
export function buildEnvironment(scene: THREE.Scene): void {
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.Fog(BG_COLOR, 26, 82);

  const root = new THREE.Group();
  root.name = 'environment';

  const HALF = 30;
  const FLOOR_Y = -0.4;
  const CEIL_Y = 21;

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x39301f, roughness: 0.95 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x2c1e12, roughness: 0.85 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });

  // Floor: dark boards, plus a warmer wainscot strip is skipped for simplicity.
  const floor = box(new THREE.MeshStandardMaterial({ color: 0x2a1c11, roughness: 0.8 }), HALF * 2, 0.4, HALF * 2, 0, FLOOR_Y - 0.2, 0);
  floor.receiveShadow = true;
  root.add(floor);

  const ceiling = box(new THREE.MeshStandardMaterial({ color: 0x1b140c, roughness: 1 }), HALF * 2, 0.4, HALF * 2, 0, CEIL_Y, 0);
  root.add(ceiling);

  root.add(box(wallMat, HALF * 2, CEIL_Y + 1, 0.5, 0, (CEIL_Y - FLOOR_Y) / 2, HALF)); // back (+z)
  root.add(box(wallMat, HALF * 2, CEIL_Y + 1, 0.5, 0, (CEIL_Y - FLOOR_Y) / 2, -HALF)); // front (-z)
  root.add(box(wallMat, 0.5, CEIL_Y + 1, HALF * 2, HALF, (CEIL_Y - FLOOR_Y) / 2, 0)); // right (+x)
  root.add(box(wallMat, 0.5, CEIL_Y + 1, HALF * 2, -HALF, (CEIL_Y - FLOOR_Y) / 2, 0)); // left (-x)

  // Rug under the board, running forward toward the camera.
  const rug = box(new THREE.MeshStandardMaterial({ color: 0x4c231e, roughness: 0.95 }), 15, 0.06, 19, 0, FLOOR_Y + 0.02, -2);
  const rugBorder = box(new THREE.MeshStandardMaterial({ color: 0x633a28, roughness: 0.95 }), 16.4, 0.04, 20.4, 0, FLOOR_Y + 0.01, -2);
  root.add(rugBorder, rug);

  // A tall, wide wall of books close behind the board fills the whole
  // backdrop; a second unit lines the right wall for when the camera swings
  // round.
  const buckets = new Map<number, THREE.Matrix4[]>();
  root.add(
    buildBookcase(buckets, woodDark, {
      width: 34,
      height: 13,
      center: new THREE.Vector3(0, FLOOR_Y + 6.5, 8.5),
      rotationY: 0,
      shelves: 7,
      rng: mulberry32(20260906),
    }),
  );
  root.add(
    buildBookcase(buckets, woodDark, {
      width: 20,
      height: 12,
      center: new THREE.Vector3(20, FLOOR_Y + 6, -4),
      rotationY: -Math.PI / 2,
      shelves: 6,
      rng: mulberry32(770118),
    }),
  );

  for (const [color, matrices] of buckets) {
    const mesh = new THREE.InstancedMesh(
      unitBox,
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      matrices.length,
    );
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  buildFireplace(root, stone);
  buildPainting(root);

  // A soft warm ceiling lamp, plus a light grazing the back shelves so the
  // books actually read from across the room.
  const lampLight = new THREE.PointLight(0xffd9a0, 1.7, 80, 2);
  lampLight.position.set(0, 17, 3);
  root.add(lampLight);

  // A spot pooled on the shelves so the books read without spilling onto
  // the board.
  const shelfSpot = new THREE.SpotLight(0xffd2a4, 90, 26, Math.PI / 4, 0.5, 1.6);
  shelfSpot.position.set(0, 13, 2);
  shelfSpot.target.position.set(0, 6, 9);
  root.add(shelfSpot, shelfSpot.target);

  scene.add(root);
}
