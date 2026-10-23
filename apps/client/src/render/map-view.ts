import * as THREE from "three";
import { MAP_COLORS, hexToRgb } from "../palette.ts";
import type { FlatCamera } from "./camera.ts";
import { applyView } from "./orthographic.ts";

export interface MapViewOptions {
  readonly width: number;
  readonly height: number;
  /** 1 for land, 0 for water, row 0 at the north pole. */
  readonly land: Uint8Array;
  readonly camera: FlatCamera;
}

/** The flat terrain map, drawn under an orthographic camera driven by a FlatCamera. */
export class MapView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly ortho = new THREE.OrthographicCamera();
  private readonly texture: THREE.DataTexture;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(readonly options: MapViewOptions) {
    const { width, height, land } = options;
    const landRgb = hexToRgb(MAP_COLORS.land);
    const oceanRgb = hexToRgb(MAP_COLORS.ocean);
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const [r, g, b] = land[i] === 1 ? landRgb : oceanRgb;
      const x = i % width;
      // Textures start at the bottom row; the grid starts at the north pole.
      const row = height - 1 - (i - x) / width;
      pixels.set([r, g, b, 255], (row * width + x) * 4);
    }
    this.texture = new THREE.DataTexture(pixels, width, height);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;

    this.geometry = new THREE.PlaneGeometry(width, height);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
    // Three copies side by side: wherever the camera sits, the world continues.
    for (const shift of [-1, 0, 1]) {
      const copy = new THREE.Mesh(this.geometry, this.material);
      copy.position.x = shift * width;
      this.scene.add(copy);
    }
    this.ortho.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.canvas = this.renderer.domElement;
  }

  /** Size of the canvas in CSS pixels; the camera is resized to match. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.options.camera.resize(width, height);
  }

  render(): void {
    const { camera, width, height } = this.options;
    applyView(this.ortho, camera.view(), width, height);
    this.renderer.render(this.scene, this.ortho);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
  }
}
