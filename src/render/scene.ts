import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEnvironment } from './environment.ts';

export interface SceneRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  boardGroup: THREE.Group;
  pieceGroup: THREE.Group;
  highlightGroup: THREE.Group;
}

/**
 * Sets up the Three.js scene: a tilted "tabletop" perspective camera,
 * warm lighting, and orbit controls constrained so the board stays framed
 * and can't be viewed from underneath. Appends the renderer's canvas into
 * `container` and wires a resize listener.
 */
export function createScene(container: HTMLElement): SceneRefs {
  const scene = new THREE.Scene();
  // Background colour + fog are set by buildEnvironment (the cosy study).

  const aspect = container.clientWidth / container.clientHeight;

  // Camera sits on the -z side looking toward +z, so White (negative z) is in
  // the foreground and Black is across the board. Look a little less steeply
  // than a plan view and aim slightly above the board centre so the cosy
  // study behind it comes into frame. On narrow / portrait viewports the
  // lens widens and the camera pulls back so the whole board still fits.
  const TARGET = new THREE.Vector3(0, 1, 0);
  const VIEW_DIR = new THREE.Vector3(0, 0.78, -1).normalize();

  function framing(a: number): { distance: number; fov: number } {
    if (a >= 1) return { distance: 13.5, fov: 45 };
    const fov = Math.min(58, 45 + (1 - a) * 24);
    const widen = Math.tan((45 * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
    return { distance: (14.8 / Math.max(a, 0.5)) * widen, fov };
  }

  const initial = framing(aspect);
  const camera = new THREE.PerspectiveCamera(initial.fov, aspect, 0.1, 100);
  camera.position.copy(VIEW_DIR).multiplyScalar(initial.distance).add(TARGET);
  camera.lookAt(TARGET);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never dip below the board
  controls.enablePan = false;

  const hemiLight = new THREE.HemisphereLight(0xffe9cf, 0x241a12, 0.5);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff4e2, 1.7);
  keyLight.position.set(6, 12, -4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 7;
  keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xdce6ff, 0.35);
  fillLight.position.set(-8, 6, 6);
  scene.add(fillLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambientLight);

  buildEnvironment(scene);

  const boardGroup = new THREE.Group();
  const pieceGroup = new THREE.Group();
  const highlightGroup = new THREE.Group();
  scene.add(boardGroup, pieceGroup, highlightGroup);

  function handleResize(): void {
    const { clientWidth, clientHeight } = container;
    const nextAspect = clientWidth / clientHeight;
    const fit = framing(nextAspect);
    camera.aspect = nextAspect;
    camera.fov = fit.fov;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);

    // On a shift to a narrower viewport (e.g. phone rotated to portrait),
    // pull back far enough that the board fits again — but only ever zoom
    // out, never override a closer view the player chose.
    if (camera.position.distanceTo(TARGET) < fit.distance - 0.01) {
      camera.position.copy(VIEW_DIR).multiplyScalar(fit.distance).add(TARGET);
    }
  }
  window.addEventListener('resize', handleResize);

  return { scene, camera, renderer, controls, boardGroup, pieceGroup, highlightGroup };
}

/** Starts a continuous render loop (also drives OrbitControls damping). */
export function startRenderLoop(refs: SceneRefs): void {
  function tick(): void {
    refs.controls.update();
    refs.renderer.render(refs.scene, refs.camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
