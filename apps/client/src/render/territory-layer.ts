import * as THREE from "three";
import { MAP_COLORS } from "../palette.ts";
import { bakeTerrainColors } from "./terrain-colors.ts";

export interface TerritoryLayerOptions {
  readonly width: number;
  readonly height: number;
  /** Owner of every tile, row 0 at the north pole. Shared, never copied. */
  readonly owners: Uint16Array;
  /** TileKind of every tile, 0 for water. Turned into ground colours once. */
  readonly terrain: Uint8Array;
  /** Whether the map wraps east-west, drawn as three copies side by side. Default true. */
  readonly wrapsX?: boolean | undefined;
  /** Elevation band on land, depth band on water, 0 to 31. Flat when left out. */
  readonly relief?: Uint8Array | undefined;
  /** Highest owner id the palette must hold. */
  readonly maxOwner: number;
  /**
   * What the map is drawn on: a plane in tiles (the default), or the unit
   * sphere, for a map whose columns span every longitude from -180 and rows
   * every latitude from the north pole. The sphere is ray-traced on a quad
   * that fills the screen, with the camera given by setGlobePose.
   */
  readonly surface?: "plane" | "sphere" | undefined;
}

/** The globe camera, as the territory layer needs it (globe-projection.ts). */
export interface GlobeRays {
  readonly position: readonly [number, number, number];
  /** Ray through the middle of the screen, and its change to the right and top edges. */
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** Surf along the coast: the brand's secondary text, light against the sea. */
const SURF = "#8DA2B6";

/** How long a tile that changed hands takes to fade into its new colour. */
const FADE_SECONDS = 0.15;

/**
 * How long a tile that changed hands lights the edge it was taken across.
 * An attack takes at least one tile every tick, so while it goes on its
 * front stays lit. The client keeps drawing for that long after a change.
 */
export const FRONT_SECONDS = 1.5;

/** Ground under fallout (R-UNIT-06): a scorched olive, mixed into the land's own colour. */
const FALLOUT = [96, 102, 34] as const;

/** Luminance of lowland ground: the relief lightens owned land above it and darkens it below. */
const GROUND_LEVEL = luminance(MAP_COLORS.land);

const PALETTE_WIDTH = 256;

/** Each row is tracked as at most 32 column chunks, one bit each. */
const CHUNKS_PER_ROW = 32;
const MIN_CHUNK_WIDTH = 64;

const vertexShader = /* glsl */ `
  uniform vec2 worldSize;
#ifdef SPHERE
  out vec3 vRay;
  uniform vec3 rayForward;
  uniform vec3 rayRight;
  uniform vec3 rayUp;

  void main() {
    // A quad over the whole screen: each pixel casts its own ray at the planet.
    vRay = rayForward + position.x * rayRight + position.y * rayUp;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
#else
  out vec2 vTile;

  void main() {
    // Local x runs over the copies of the world, local y from south to north.
    vTile = vec2(position.x, worldSize.y - position.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
#endif
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;

#ifdef SPHERE
  in vec3 vRay;
  uniform vec3 eye;
#else
  in vec2 vTile;
#endif
  layout(location = 0) out highp vec4 outColor;

  uniform usampler2D owners;
  uniform sampler2D ground;
  uniform sampler2D takenAt;
  uniform sampler2D palette;
  uniform vec2 worldSize;
  uniform bool wrapsX;
  uniform float now;
  uniform float fadeSeconds;
  uniform float frontSeconds;
  uniform float frontMotion;
  uniform vec3 surfColor;
  uniform float reliefShading;
  uniform float groundLevel;
  uniform uint highlight;
  uniform uint hovered;

  ivec2 wrapTile(ivec2 tile) {
    ivec2 size = ivec2(worldSize);
    int x = wrapsX ? (tile.x % size.x + size.x) % size.x : clamp(tile.x, 0, size.x - 1);
    return ivec2(x, clamp(tile.y, 0, size.y - 1));
  }

  uint ownerAt(ivec2 tile) { return texelFetch(owners, wrapTile(tile), 0).r; }

  /**
   * Distance in tiles from the point to the nearest of the sides marked:
   * east, west, south, north. A column is columnWidth rows wide, less than
   * one near the poles of a globe.
   */
  float edgeDistance(vec2 f, bvec4 sides, float columnWidth) {
    float d = 2.0;
    if (sides.x) d = min(d, (1.0 - f.x) * columnWidth);
    if (sides.y) d = min(d, f.x * columnWidth);
    if (sides.z) d = min(d, 1.0 - f.y);
    if (sides.w) d = min(d, f.y);
    return d;
  }

  void main() {
  #ifdef SPHERE
    // Where the ray meets the unit sphere. Off the planet the root is clamped
    // rather than skipped, so the derivatives stay defined up to the rim.
    vec3 ray = normalize(vRay);
    float b = dot(eye, ray);
    float hit = b * b - dot(eye, eye) + 1.0;
    float rim = 2.0 * fwidth(hit);
    vec3 point = normalize(eye + (-b - sqrt(max(hit, 0.0))) * ray);
    float lat = asin(clamp(point.y, -1.0, 1.0));
    float lon = atan(-point.z, point.x);
    vec2 at = vec2((lon / 6.2831853 + 0.5) * worldSize.x, (0.5 - lat / 3.1415927) * worldSize.y);
    // Rows keep their size on the sphere; columns narrow toward the poles, and
    // their coordinate jumps across the antimeridian, so only rows give the scale.
    float pixel = max(fwidth(at.y), 1e-4);
    float columnWidth = cos(lat) * 2.0 * worldSize.y / worldSize.x;
    // Pixels clear of the rim stop here, once every derivative is taken: after
    // a discard, derivatives are undefined on some GPUs. Those next to it go
    // on, so the rim keeps its derivatives.
    if (hit < -rim) discard;
  #else
    vec2 at = vTile;
    // Tiles per screen pixel, for lines that stay sharp and visible at any zoom.
    float pixel = max(fwidth(at.x), 1e-4);
    float columnWidth = 1.0;
  #endif
    ivec2 tile = wrapTile(ivec2(floor(at)));
    vec2 f = fract(at);

    // Ground colour and coast sides, computed once for the whole map (terrain-colors.ts).
    vec4 groundTexel = texelFetch(ground, tile, 0);
    vec3 color = groundTexel.rgb;
    uint coast = uint(groundTexel.a * 255.0 + 0.5);
    if (coast != 0u) {
      bvec4 land = bvec4((coast & 1u) != 0u, (coast & 2u) != 0u, (coast & 4u) != 0u, (coast & 8u) != 0u);
      float surf = 1.0 - smoothstep(0.0, max(0.12, 1.2 * pixel), edgeDistance(f, land, columnWidth));
      color = mix(color, surfColor, surf * 0.55);
    }

    uint owner = ownerAt(tile);
    if (owner != 0u) {
      ivec2 entry = ivec2(int(owner % ${String(PALETTE_WIDTH)}u), int(owner / ${String(PALETTE_WIDTH)}u));
      vec4 paletteTexel = texelFetch(palette, entry, 0);
      vec3 ownerColor = paletteTexel.rgb;
      // Allies of the player are flagged in the palette's alpha (setAllies).
      bool allied = paletteTexel.a < 0.75;
      // Borders are found here rather than in the simulation: no border data to upload.
      bvec4 other = bvec4(ownerAt(tile + ivec2(1, 0)) != owner, ownerAt(tile - ivec2(1, 0)) != owner,
        ownerAt(tile + ivec2(0, 1)) != owner, ownerAt(tile - ivec2(0, 1)) != owner);
      // Zoomed in, the fill lets the relief through; zoomed out, it is solid, so
      // small countries keep their colour and the edge is one clean pixel.
      float zoomedOut = smoothstep(0.4, 1.5, pixel);
      // The relief shades the owner's colour rather than showing through it:
      // pale colours stay apart from the grey of the mountains.
      float relief = clamp(dot(color, vec3(0.2126, 0.7152, 0.0722)) / groundLevel, 0.8, 1.15);
      vec3 fillColor = ownerColor * mix(mix(1.0, relief, reliefShading), 1.0, zoomedOut);
      // The land under the pointer is lit whole, wherever its pieces lie.
      bool pointed = owner == hovered;
      if (pointed) fillColor = mix(fillColor, vec3(1.0), 0.25);
      // The player's own land has a wider, whiter rim, to find it on a crowded map.
      bool mine = owner == highlight;
      bool wide = mine || allied || pointed;
      float width = wide ? max(0.4, 2.5 * pixel) : max(0.22, pixel);
      float edge = edgeDistance(f, other, columnWidth);
      float border = 1.0 - smoothstep(width - pixel, width, edge);
      // An ally's rim is as wide, in dashes about eight pixels long.
      if (allied) border *= step(0.5, fract((at.x + at.y) / (16.0 * pixel)));
      vec3 rimColor = mix(ownerColor, vec3(1.0), wide ? 0.75 : 0.3);
      vec3 owned = mix(fillColor, rimColor, border);
      float age = now - texelFetch(takenAt, tile, 0).r;
      // Land taken in the last moments marks the front of an attack: its edge
      // turns to light and dark stripes that march along it, readable on any
      // colour, and the strip behind it pulses. Zoomed out, where a tile is
      // under a pixel and edges vanish, the strip takes the stripes instead.
      float front = 1.0 - smoothstep(fadeSeconds, frontSeconds, age);
      if (front > 0.0) {
        float march = fract((at.x + at.y) / (14.0 * pixel) - now * 1.6 * frontMotion);
        vec3 stripes = step(0.5, march) > 0.0 ? vec3(1.0, 0.96, 0.86) : vec3(0.04, 0.075, 0.11);
        float pulse = mix(0.75, 0.5 + 0.5 * sin(now * 7.0), frontMotion);
        vec3 wake = mix(vec3(1.0), stripes, zoomedOut);
        owned = mix(owned, wake, front * mix(0.18 + 0.17 * pulse, 0.7, zoomedOut));
        float frontWidth = max(0.6, 3.5 * pixel);
        float frontEdge = 1.0 - smoothstep(frontWidth - pixel, frontWidth, edge);
        owned = mix(owned, stripes, front * frontEdge);
      }
      // A tile taken a moment ago fades in, so fronts creep instead of jumping each tick.
      color = mix(color, owned, smoothstep(0.0, fadeSeconds, age));
    }
  #ifdef SPHERE
    if (hit < 0.0) discard;
    // Darker toward the rim, so the planet reads as round.
    color *= mix(0.45, 1.0, sqrt(max(dot(point, -ray), 0.0)));
  #endif
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
 * On a map that wraps, the mesh spans three copies of the world side by
 * side, so a camera kept over the middle copy never sees an edge. A flat map
 * is drawn once.
 */
export class TerritoryLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly ownerTexture: THREE.DataTexture;
  readonly paletteTexture: THREE.DataTexture;
  /** Colour of the ground under each tile, with its coast sides in alpha. */
  readonly groundTexture: THREE.DataTexture;
  /** When each tile last changed hands, in seconds on the layer's clock. */
  readonly takenAtTexture: THREE.DataTexture;
  private readonly takenAt: Float32Array;
  /** The globe camera's rays, read by the shader on a sphere. */
  private readonly rays = {
    eye: new THREE.Vector3(0, 0, 3),
    rayForward: new THREE.Vector3(0, 0, -1),
    rayRight: new THREE.Vector3(1, 0, 0),
    rayUp: new THREE.Vector3(0, 1, 0),
  };
  private readonly paletteData: Uint8Array;
  private readonly chunkWidth: number;
  private readonly dirtyChunks: Uint32Array;
  private readonly dirtyRows: Int32Array;
  private dirtyRowCount = 0;
  private readonly wrapsX: boolean;
  /** Ground colours as baked, to put back where fallout clears; made on first use. */
  private pristineGround: Uint8Array | undefined;
  /** Tiles drawn under fallout now, and the zones they come from. */
  private scorched: number[] = [];
  private falloutKey = "";
  private fullRefresh = false;

  constructor(readonly options: TerritoryLayerOptions) {
    const { width, height, owners, terrain, maxOwner } = options;
    const wrapsX = options.wrapsX ?? true;
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

    this.groundTexture = new THREE.DataTexture(
      bakeTerrainColors({
        width,
        height,
        kinds: terrain,
        relief: options.relief ?? new Uint8Array(width * height),
        wrapsX,
      }),
      width,
      height,
    );
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.wrapsX = wrapsX;

    // Long ago: nothing fades on the first frame.
    this.takenAt = new Float32Array(width * height).fill(-1e6);
    this.takenAtTexture = new THREE.DataTexture(
      this.takenAt,
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.takenAtTexture.internalFormat = "R32F";

    const rows = Math.ceil((maxOwner + 1) / PALETTE_WIDTH);
    this.paletteData = new Uint8Array(PALETTE_WIDTH * rows * 4);
    this.paletteTexture = new THREE.DataTexture(this.paletteData, PALETTE_WIDTH, rows);
    this.paletteTexture.colorSpace = THREE.SRGBColorSpace;

    for (const texture of [
      this.ownerTexture,
      this.groundTexture,
      this.takenAtTexture,
      this.paletteTexture,
    ]) {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // Rows of 8- and 16-bit texels are not 4-byte aligned on every map width.
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }

    const sphere = options.surface === "sphere";
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: sphere ? { SPHERE: 1 } : {},
      vertexShader,
      fragmentShader,
      uniforms: {
        owners: { value: this.ownerTexture },
        ground: { value: this.groundTexture },
        takenAt: { value: this.takenAtTexture },
        palette: { value: this.paletteTexture },
        worldSize: { value: new THREE.Vector2(width, height) },
        wrapsX: { value: wrapsX },
        now: { value: 0 },
        fadeSeconds: { value: FADE_SECONDS },
        frontSeconds: { value: FRONT_SECONDS },
        frontMotion: { value: 1 },
        surfColor: { value: new THREE.Color(SURF) },
        reliefShading: { value: 1 },
        groundLevel: { value: GROUND_LEVEL },
        highlight: { value: 0 },
        hovered: { value: 0 },
        eye: { value: this.rays.eye },
        rayForward: { value: this.rays.rayForward },
        rayRight: { value: this.rays.rayRight },
        rayUp: { value: this.rays.rayUp },
      },
      // The globe's quad covers the whole screen and must not hide what is drawn over it.
      depthWrite: !sphere,
    });
    const geometry = sphere
      ? new THREE.PlaneGeometry(2, 2)
      : new THREE.PlaneGeometry(wrapsX ? width * 3 : width, height);
    // Local coordinates: x in [-width, 2 * width) or, on a flat map, [0, width); y in [0, height).
    if (!sphere) geometry.translate(width / 2, height / 2, 0);
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
      [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)],
      owner * 4,
    );
    // The alpha holds the ally flag: a new colour keeps it.
    this.paletteData[owner * 4 + 3] ||= 255;
    this.paletteTexture.needsUpdate = true;
  }

  /** Owners whose land gets a dashed wide rim: the allies of the player at this screen. */
  setAllies(allies: readonly number[]): void {
    const flagged = new Set(allies);
    for (let owner = 1; owner <= this.options.maxOwner; owner++) {
      this.paletteData[owner * 4 + 3] = flagged.has(owner) ? 128 : 255;
    }
    this.paletteTexture.needsUpdate = true;
  }

  /**
   * Discs of land under fallout (R-UNIT-06), drawn as scorched ground:
   * unowned, and a sickly olive rather than its own colour. Zones change
   * only when a heavy missile strikes or its fallout clears, so the ground
   * texture is sent again only then. Returns whether anything changed.
   */
  setFallout(zones: readonly { x: number; y: number; radius: number }[]): boolean {
    const key = zones.map((z) => `${String(z.x)},${String(z.y)},${String(z.radius)}`).join(";");
    if (key === this.falloutKey) return false;
    this.falloutKey = key;
    const { width, height, terrain } = this.options;
    const data = this.groundTexture.image.data as Uint8Array;
    this.pristineGround ??= data.slice();
    const pristine = this.pristineGround;
    for (const tile of this.scorched) {
      for (let c = 0; c < 3; c++) data[tile * 4 + c] = pristine[tile * 4 + c] as number;
    }
    this.scorched = [];
    for (const { x, y, radius } of zones) {
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          let column = x + dx;
          if (this.wrapsX) column = ((column % width) + width) % width;
          else if (column < 0 || column >= width) continue;
          const tile = row * width + column;
          if (terrain[tile] === 0) continue;
          this.scorched.push(tile);
          for (let c = 0; c < 3; c++) {
            const base = pristine[tile * 4 + c] as number;
            data[tile * 4 + c] = Math.round(base * 0.35 + (FALLOUT[c] as number) * 0.65);
          }
        }
      }
    }
    this.groundTexture.needsUpdate = true;
    return true;
  }

  /** The owner whose land gets the wide rim, usually the player at this screen; 0 for none. */
  setHighlight(owner: number): void {
    const highlight = this.mesh.material.uniforms.highlight;
    if (highlight) highlight.value = owner;
  }

  /** The owner whose land is under the pointer, lit whole; 0 for none. */
  setHovered(owner: number): void {
    const hovered = this.mesh.material.uniforms.hovered;
    if (hovered) hovered.value = owner;
  }

  /** Whether the glint runs along attack fronts; off for players who ask for less motion. */
  setMotion(moving: boolean): void {
    const motion = this.mesh.material.uniforms.frontMotion;
    if (motion) motion.value = moving ? 1 : 0;
  }

  /** Points the rays of a globe at the planet; set once per frame. Ignored on a plane. */
  setGlobePose(rays: GlobeRays): void {
    const { eye, rayForward, rayRight, rayUp } = this.rays;
    eye.set(...rays.position);
    rayForward.set(...rays.forward);
    rayRight.set(...rays.right);
    rayUp.set(...rays.up);
  }

  /** Seconds on the clock that fades new tiles in; set once per frame. */
  setTime(seconds: number): void {
    const now = this.mesh.material.uniforms.now;
    if (now) now.value = seconds;
  }

  /**
   * Marks tiles whose owner changed in the shared array. With a time, they
   * fade in from that moment on; without one, they appear at once.
   */
  markChanged(tiles: ArrayLike<number>, seconds?: number): void {
    const { width } = this.options;
    const { chunkWidth, dirtyChunks } = this;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i] as number;
      if (seconds !== undefined) this.takenAt[tile] = seconds;
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
    const textures = [this.ownerTexture, this.takenAtTexture];
    let texels = 0;
    if (this.fullRefresh) {
      for (const texture of textures) {
        texture.clearUpdateRanges();
        texture.needsUpdate = true;
      }
      texels = width * height;
    } else if (this.dirtyRowCount > 0) {
      for (let i = 0; i < this.dirtyRowCount; i++) {
        texels += this.queueRow(this.dirtyRows[i] as number);
      }
      for (const texture of textures) texture.needsUpdate = true;
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
      this.takenAtTexture.addUpdateRange((y * width + from) * 4, count * 4);
      texels += count;
    }
    return texels;
  }

  /** Bytes the layer's textures take on the GPU, mipmaps excluded. */
  gpuBytes(): number {
    const { width, height } = this.options;
    // Owners, ground colours, and the time each tile changed hands.
    return width * height * (2 + 4 + 4) + this.paletteData.byteLength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.ownerTexture.dispose();
    this.groundTexture.dispose();
    this.takenAtTexture.dispose();
    this.paletteTexture.dispose();
  }
}

function luminance(hex: string): number {
  const { r, g, b } = new THREE.Color(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
