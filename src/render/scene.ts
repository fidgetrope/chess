import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  scene.background = new THREE.Color(0x14100c);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100,
  );
  // On the -z side, looking toward +z: White (rows 0-2, negative z) sits in
  // the foreground nearest the camera, Black across the board on the far side.
  camera.position.set(0, 8.5, -9);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never dip below the board
  controls.enablePan = false;

  const hemiLight = new THREE.HemisphereLight(0xfff2e0, 0x2a2018, 0.55);
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

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambientLight);

  const boardGroup = new THREE.Group();
  const pieceGroup = new THREE.Group();
  const highlightGroup = new THREE.Group();
  scene.add(boardGroup, pieceGroup, highlightGroup);

  function handleResize(): void {
    const { clientWidth, clientHeight } = container;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
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
