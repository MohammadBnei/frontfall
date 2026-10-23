import type * as THREE from "three";
import type { CameraView } from "./camera.ts";

/**
 * Points a Three.js camera at a view. Scene units are tiles with the origin at
 * the centre of the middle copy of the world and y pointing north, so a centre
 * column kept in [0, width) never leaves the three copies drawn side by side.
 */
export function applyView(
  camera: THREE.OrthographicCamera,
  view: CameraView,
  worldWidth: number,
  worldHeight: number,
): void {
  camera.position.x = view.centerX - worldWidth / 2;
  camera.position.y = worldHeight / 2 - view.centerY;
  camera.left = -view.halfWidth;
  camera.right = view.halfWidth;
  camera.top = view.halfHeight;
  camera.bottom = -view.halfHeight;
  camera.updateProjectionMatrix();
}
