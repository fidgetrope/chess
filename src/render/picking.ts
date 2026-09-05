import * as THREE from 'three';
import type { Square } from '../core/types.ts';

const CLICK_MOVE_THRESHOLD = 6; // px; beyond this a pointerdown->up is an orbit-drag, not a tap

/**
 * Wires click/tap-to-pick on the renderer's canvas. Uses pointerdown/up
 * (not the bare `click` event) so a camera-orbit drag via OrbitControls is
 * never misread as a square selection.
 *
 * `getPickableObjects` is called fresh on every pick so callers don't have
 * to keep this module's list in sync. `onPick` receives the logical Square
 * of whatever was hit (tile or piece — `userData.square` is found by
 * walking up the parent chain, since a piece's geometry is nested in a
 * tagged group), or `null` if nothing pickable was hit.
 *
 * Returns a cleanup function that removes the listeners.
 */
export function setupPicking(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  getPickableObjects: () => THREE.Object3D[],
  onPick: (square: Square | null) => void,
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  function handlePointerDown(event: PointerEvent): void {
    downX = event.clientX;
    downY = event.clientY;
  }

  function handlePointerUp(event: PointerEvent): void {
    const dx = event.clientX - downX;
    const dy = event.clientY - downY;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return; // was a drag

    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(getPickableObjects(), true);

    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData?.square) obj = obj.parent;
      if (obj?.userData?.square) {
        onPick(obj.userData.square as Square);
        return;
      }
    }
    onPick(null);
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);

  return () => {
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
    renderer.domElement.removeEventListener('pointerup', handlePointerUp);
  };
}
