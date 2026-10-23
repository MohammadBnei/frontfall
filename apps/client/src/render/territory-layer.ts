import * as THREE from "three";
import { MAP_COLORS } from "../palette.ts";

export interface TerritoryLayerOptions {
  readonly width: number;
  readonly height: number;
  /** Owner of every tile, row 0 at the north pole. Shared, never copied. */
  readonly owners: Uint16Array;
  /** TileKind of every tile, 0 for water. Uploaded once. */
  readonly terrain: Uint8Array;
  /** Highest owner id the palette must hold. */
  readonly maxOwner: number;
}

const PALETTE_WIDTH = 256;

/** Each row is tracked as at most 32 column chunks, one bit each. */
const CHUNKS_PER_ROW = 32;
const MIN_CHUNK_WIDTH = 64;

const vertexShader = /* glsl */ `
  out vec2 vTile;
  uniform vec2 worldSize;

  void main() {
    // Local x runs over three copies of the world, local y from south to north.
    vTile = vec2(position.x, worldSize.y - position.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;

  in vec2 vTile;
  layout(location = 0) out highp vec4 outColor;

  uniform usampler2D owners;
  uniform highp usampler2D terrain;
  uniform sampler2D palette;
  uniform vec2 worldSize;
  uniform vec3 waterColor;
  uniform vec3 landColor;
  uniform vec3 highColor;
  uniform vec3 peakColor;
  uniform float fillOpacity;

  uint ownerAt(ivec2 tile) {
    ivec2 size = ivec2(worldSize);
    tile.x = (tile.x % size.x + size.x) % size.x;
    tile.y = clamp(tile.y, 0, size.y - 1);
    return texelFetch(owners, tile, 0).r;
  }

  void main() {
    ivec2 tile = ivec2(floor(vTile));
    tile.x = (tile.x % int(worldSize.x) + int(worldSize.x)) % int(worldSize.x);
    tile.y = clamp(tile.y, 0, int(worldSize.y) - 1);

    // TileKind: water, plains, hills, mountains, impassable (ice caps, glaciers).
    uint kind = texelFetch(terrain, tile, 0).r;
    vec3 color = kind == 0u ? waterColor
      : kind == 1u ? landColor
      : kind == 2u ? mix(landColor, highColor, 0.6)
      : kind == 3u ? mix(highColor, peakColor, 0.15)
      : peakColor;

    uint owner = ownerAt(tile);
    if (owner != 0u) {
      ivec2 entry = ivec2(int(owner % ${String(PALETTE_WIDTH)}u), int(owner / ${String(PALETTE_WIDTH)}u));
      vec3 ownerColor = texelFetch(palette, entry, 0).rgb;
      // Borders are found here rather than in the simulation: no border data to upload.
      bool border = ownerAt(tile + ivec2(1, 0)) != owner || ownerAt(tile - ivec2(1, 0)) != owner
        || ownerAt(tile + ivec2(0, 1)) != owner || ownerAt(tile - ivec2(0, 1)) != owner;
      color = border ? ownerColor : mix(color, ownerColor, fillOpacity);
    }
    outColor = linearToOutputTexel(vec4(color, 1.0));
  }
`;

/**
 * Draws ownership for the whole world in one draw call: owners live in a
 * 16-bit integer texture that aliases the simulation's array, and a shader
 * turns ids into colours and finds borders. Only the parts of rows that
 * changed since the last frame are uploaded again: each row is split into up
 * to 32 chunks, and a chunk is sent if any of its tiles changed.
 *
 * The mesh spans three copies of the world side by side, so a camera kept
 * over the middle copy never sees an edge.
 */
export class TerritoryLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly ownerTexture: THREE.DataTexture;
  readonly paletteTexture: THREE.DataTexture;
  readonly terrainTexture: THREE.DataTexture;
  private readonly paletteData: Uint8Array;
  private readonly chunkWidth: number;
  private readonly dirtyChunks: Uint32Array;
  private readonly dirtyRows: Int32Array;
  private dirtyRowCount = 0;
  private fullRefresh = false;

  constructor(readonly options: TerritoryLayerOptions) {
    const { width, height, owners, terrain, maxOwner } = options;
    if (owners.length !== width * height || terrain.length !== width * height) {
      throw new RangeError("owner and terrain arrays must cover the whole map");
    }

    this.ownerTexture = new THREE.DataTexture(
      owners,
      width,
      height,
      THREE.RedIntegerFormat,
      THREE.UnsignedShortType,
    );
    this.ownerTexture.internalFormat = "R16UI";

    this.terrainTexture = new THREE.DataTexture(
      terrain,
      width,
      height,
      THREE.RedIntegerFormat,
      THREE.UnsignedByteType,
    );
    this.terrainTexture.internalFormat = "R8UI";

    const rows = Math.ceil((maxOwner + 1) / PALETTE_WIDTH);
    this.paletteData = new Uint8Array(PALETTE_WIDTH * rows * 4);
    this.paletteTexture = new THREE.DataTexture(this.paletteData, PALETTE_WIDTH, rows);
    this.paletteTexture.colorSpace = THREE.SRGBColorSpace;

    for (const texture of [this.ownerTexture, this.terrainTexture, this.paletteTexture]) {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // Rows of 8- and 16-bit texels are not 4-byte aligned on every map width.
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        owners: { value: this.ownerTexture },
        terrain: { value: this.terrainTexture },
        palette: { value: this.paletteTexture },
        worldSize: { value: new THREE.Vector2(width, height) },
        waterColor: { value: new THREE.Color(MAP_COLORS.ocean) },
        landColor: { value: new THREE.Color(MAP_COLORS.land) },
        highColor: { value: new THREE.Color(MAP_COLORS.landHigh) },
        // Secondary text of the brand: light enough to read as rock and ice.
        peakColor: { value: new THREE.Color("#8DA2B6") },
        fillOpacity: { value: 0.55 },
      },
    });
    const geometry = new THREE.PlaneGeometry(width * 3, height);
    // Local coordinates: x in [-width, 2 * width), y in [0, height).
    geometry.translate(width / 2, height / 2, 0);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;

    this.chunkWidth = Math.max(MIN_CHUNK_WIDTH, Math.ceil(width / CHUNKS_PER_ROW));
    this.dirtyChunks = new Uint32Array(height);
    this.dirtyRows = new Int32Array(height);
  }

  setOwnerColor(owner: number, color: THREE.ColorRepresentation): void {
    if (!Number.isInteger(owner) || owner < 1 || owner > this.options.maxOwner) {
      throw new RangeError(`owner ${String(owner)} has no palette entry`);
    }
    const rgb = new THREE.Color(color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    this.paletteData.set(
      [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), 255],
      owner * 4,
    );
    this.paletteTexture.needsUpdate = true;
  }

  /** Marks tiles whose owner changed in the shared array. */
  markChanged(tiles: ArrayLike<number>): void {
    const { width } = this.options;
    const { chunkWidth, dirtyChunks } = this;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i] as number;
      const x = tile % width;
      const y = (tile - x) / width;
      const mask = dirtyChunks[y] as number;
      if (mask === 0) this.dirtyRows[this.dirtyRowCount++] = y;
      dirtyChunks[y] = mask | (1 << Math.floor(x / chunkWidth));
    }
  }

  /** Too many changes to track: upload the whole texture on the next frame. */
  markAllChanged(): void {
    this.fullRefresh = true;
  }

  /**
   * Turns pending changes into texture uploads. Call once per frame before
   * rendering; returns the number of texels sent to the GPU.
   */
  flush(): number {
    const { width, height } = this.options;
    const texture = this.ownerTexture;
    let texels = 0;
    if (this.fullRefresh) {
      texture.clearUpdateRanges();
      texture.needsUpdate = true;
      texels = width * height;
    } else if (this.dirtyRowCount > 0) {
      for (let i = 0; i < this.dirtyRowCount; i++) {
        texels += this.queueRow(this.dirtyRows[i] as number);
      }
      texture.needsUpdate = true;
    }
    for (let i = 0; i < this.dirtyRowCount; i++) this.dirtyChunks[this.dirtyRows[i] as number] = 0;
    this.dirtyRowCount = 0;
    this.fullRefresh = false;
    return texels;
  }

  /** Queues one update range per run of dirty chunks in a row; returns its texels. */
  private queueRow(y: number): number {
    const { width } = this.options;
    const mask = this.dirtyChunks[y] as number;
    let texels = 0;
    let chunk = 0;
    while (chunk < CHUNKS_PER_ROW) {
      if (((mask >>> chunk) & 1) === 0) {
        chunk++;
        continue;
      }
      const first = chunk;
      while (chunk < CHUNKS_PER_ROW && ((mask >>> chunk) & 1) === 1) chunk++;
      const from = first * this.chunkWidth;
      const count = Math.min(width, chunk * this.chunkWidth) - from;
      // three.js measures update ranges in RGBA components whatever the
      // format, hence the factor 4 for a single-channel texture.
      this.ownerTexture.addUpdateRange((y * width + from) * 4, count * 4);
      texels += count;
    }
    return texels;
  }

  /** Bytes the layer's textures take on the GPU, mipmaps excluded. */
  gpuBytes(): number {
    const { width, height } = this.options;
    return width * height * 2 + width * height + this.paletteData.byteLength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.ownerTexture.dispose();
    this.terrainTexture.dispose();
    this.paletteTexture.dispose();
  }
}
