import * as THREE from "three";

export interface UnitLayerOptions {
  /** Width of the world in tiles, to wrap units across the seam. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Most units drawn at once; the buffers are sized for it up front. */
  readonly capacity: number;
  /** Footprint of a unit in tiles. */
  readonly size?: number;
}

const vertexShader = /* glsl */ `
  uniform float worldWidth;
  uniform float cameraX;
  out vec3 vColor;

  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // Draw each unit on the copy of the world closest to the camera.
    world.x += worldWidth * floor((cameraX - world.x) / worldWidth + 0.5);
    vColor = instanceColor;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  in vec3 vColor;
  layout(location = 0) out highp vec4 outColor;

  void main() {
    outColor = linearToOutputTexel(vec4(vColor, 1.0));
  }
`;

/**
 * Every unit of one kind in a single instanced draw call. Positions are in
 * tiles; the vertex shader moves each unit next to the camera across the
 * east-west seam, so no unit is duplicated to cover the wrap.
 */
export class UnitLayer {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly cameraX = { value: 0 };
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(readonly options: UnitLayerOptions) {
    const size = options.size ?? 3;
    // Eight triangles per unit: measured cheaper than a quad with a round
    // discard in the fragment shader, which also turns off early depth tests.
    const geometry = new THREE.CircleGeometry(size / 2, 8);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        worldWidth: { value: options.worldWidth },
        cameraX: this.cameraX,
      },
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, options.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Units wrap in the shader, so the CPU-side bounds are meaningless.
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.count;
  }

  set count(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > this.options.capacity) {
      throw new RangeError(`unit count ${String(value)} exceeds the capacity`);
    }
    this.mesh.count = value;
  }

  /** Places unit `index` at tile coordinates (x, y), y counted from the north. */
  set(index: number, x: number, y: number, color: THREE.ColorRepresentation): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.options.capacity) {
      throw new RangeError(`unit ${String(index)} is outside the capacity`);
    }
    this.matrix.makeTranslation(x + 0.5, this.options.worldHeight - y - 0.5, 0.1);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.dirtyFrom = Math.min(this.dirtyFrom, index);
    this.dirtyTo = Math.max(this.dirtyTo, index);
  }

  /**
   * Follows the camera across the seam and uploads the span of instances
   * changed since the last call; returns how many instances were sent.
   */
  update(cameraX: number): number {
    this.cameraX.value = cameraX;
    if (this.dirtyTo < 0) return 0;
    const count = this.dirtyTo - this.dirtyFrom + 1;
    const { instanceMatrix, instanceColor } = this.mesh;
    instanceMatrix.addUpdateRange(this.dirtyFrom * 16, count * 16);
    instanceMatrix.needsUpdate = true;
    if (instanceColor) {
      instanceColor.addUpdateRange(this.dirtyFrom * 3, count * 3);
      instanceColor.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
    return count;
  }

  /** Bytes of instance data on the GPU at full capacity. */
  gpuBytes(): number {
    return this.options.capacity * (16 + 3) * 4;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
