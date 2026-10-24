import * as THREE from "three";
import { MAP_COLORS } from "../palette.ts";
import type { CameraView } from "./camera.ts";
import { applyView } from "./orthographic.ts";
import { TerritoryLayer } from "./territory-layer.ts";

export interface MapViewOptions {
  readonly width: number;
  readonly height: number;
  /** TileKind of every tile; 0 is water. */
  readonly kinds: Uint8Array;
  /** Whether the map wraps east-west. */
  readonly wrapsX: boolean;
  /** Owner of every tile, kept up to date by the caller and read in place. */
  readonly owners: Uint16Array;
  readonly maxOwner: number;
}

/**
 * The flat map: one WebGL canvas, the territory layer, and an orthographic
 * camera placed from the view of the interface's camera.
 */
export class MapView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly territory: TerritoryLayer;

  constructor(readonly options: MapViewOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(MAP_COLORS.oceanDeep);
    this.canvas = this.renderer.domElement;
    this.territory = new TerritoryLayer({
      width: options.width,
      height: options.height,
      owners: options.owners,
      terrain: options.kinds,
      wrapsX: options.wrapsX,
      maxOwner: options.maxOwner,
    });
    // The layer spans x in [-width, 2 * width) and y in [0, height) from the
    // south edge; applyView puts the origin at the centre of the middle copy.
    this.territory.mesh.position.set(-options.width / 2, -options.height / 2, 0);
    this.scene.add(this.territory.mesh);
    this.camera.position.z = 10;
  }

  setPlayerColor(id: number, color: string): void {
    this.territory.setOwnerColor(id, color);
  }

  /** Tiles whose owner changed in the shared array since the last frame. */
  markChanged(tiles: ArrayLike<number>): void {
    this.territory.markChanged(tiles);
  }

  markAllChanged(): void {
    this.territory.markAllChanged();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  render(view: CameraView): void {
    applyView(this.camera, view, this.options.width, this.options.height);
    this.territory.flush();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.territory.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
