import * as THREE from "three";

/**
 * Ships as tactical markers (docs/art-direction.md, Ships): one instanced
 * quad per ship, the marker, its rim and a dotted wake fixed to the sea all
 * computed per pixel. No bitmap. Kept out of the first visit with the other
 * map layers (lazy.ts).
 */

export type ShipKind = "trade" | "transport" | "warship";

const KIND_ID: Record<ShipKind, number> = { trade: 0, transport: 1, warship: 2 };

/**
 * Length of each marker in tiles, and its smallest length on screen in CSS
 * pixels: a marker never shrinks below a readable mark, and the type is read
 * from the silhouette (a diamond, a double chevron, a notched dart).
 * The vertex shader holds the same figures.
 */
export const HULL_SIZES = {
  trade: { tiles: 1.6, minPixels: 21 },
  transport: { tiles: 2.5, minPixels: 27 },
  warship: { tiles: 3.5, minPixels: 42 },
} as const;

/** On a phone the floor is a little larger, and so is everything the finger has to find. */
const PHONE_FACTOR = 1.12;
/** Between these lengths on screen, in CSS pixels, a marker passes from the far silhouette to its glyph and true proportions. */
const DETAIL_FROM = 30;
const DETAIL_TO = 84;
/** A ship that moves this fast, in tiles per second, leaves its full wake. */
const FULL_SPEED = 8;

export interface ShipLayerOptions {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly wrapsX?: boolean;
  /** Most hulls drawn at once; the buffers are sized for it up front. */
  readonly capacity: number;
  /** TileKind of every tile, 0 for water: the wake stops at the shore. */
  readonly kinds: Uint8Array;
  /** The light picture of the Saver profile: no halo round the marker. */
  readonly flat?: boolean;
  /** A phone, which asks for larger markers. */
  readonly phone?: boolean;
}

/** One ship to draw, y counted from the north. */
export interface Hull {
  readonly kind: ShipKind;
  readonly x: number;
  readonly y: number;
  /** Radians, 0 east, a quarter turn south. */
  readonly heading: number;
  /** Tiles per second. */
  readonly speed: number;
  readonly color: string;
  /** A warship that has just fired, from 1 on the shot to 0 as the sign of it fades; 0 for the rest. */
  readonly flash?: number;
  /** Tells two hulls apart; kept for the callers, the markers no longer vary. */
  readonly seed: number;
}

const vertexShader = /* glsl */ `
in vec2 iPos; in float iAng; in vec4 iKind; in vec3 iCol;
uniform float worldWidth; uniform float worldHeight; uniform float cameraX; uniform bool wrapsX;
uniform float tilesPerPixel; uniform float phone; uniform vec2 detail;
out vec2 vLoc; out vec2 vWorld; flat out float vL; flat out float vKind; flat out vec3 vCol; flat out float vSpeed; flat out vec2 vDir; flat out float vDet; flat out float vFlash;
void main() {
  float kind = iKind.x;
  vec2 hull = kind < 0.5 ? vec2(1.6, 21.0) : (kind < 1.5 ? vec2(2.5, 27.0) : vec2(3.5, 42.0));
  // The marker is drawn longer than the hull, since its pointed ends read shorter than a hull's: the diamond most.
  float L = max(hull.x, hull.y * phone * tilesPerPixel) * (kind < 0.5 ? 1.25 : 1.15);
  // A tight quad: the marker and its halo, and behind a moving ship its wake.
  vec2 loc = vec2(mix(iKind.z > 0.02 ? -1.85 : -0.68, 0.68, position.x + 0.5), position.y);
  float c = cos(iAng), s = sin(iAng);
  vec2 centre = iPos + 0.5;
  vec4 at = modelMatrix * vec4(centre.x, worldHeight - centre.y, 0.0, 1.0);
  // The copy of the world nearest the camera, judged by the centre so that no hull is torn at the seam.
  float shift = wrapsX ? worldWidth * floor((cameraX - at.x) / worldWidth + 0.5) : 0.0;
  vec2 w = centre + vec2(c * loc.x - s * loc.y, s * loc.x + c * loc.y) * L;
  vLoc = loc; vWorld = w; vL = L; vKind = kind; vCol = iCol; vSpeed = iKind.z; vDir = vec2(c, s); vFlash = iKind.y;
  vDet = smoothstep(detail.x, detail.y, L / tilesPerPixel);
  vec4 world = modelMatrix * vec4(w.x, worldHeight - w.y, 0.2, 1.0);
  world.x += shift;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
in vec2 vLoc; in vec2 vWorld; flat in float vL; flat in float vKind; flat in vec3 vCol; flat in float vSpeed; flat in vec2 vDir; flat in float vDet; flat in float vFlash;
uniform float reduced; uniform float tilesPerPixel;
uniform sampler2D land; uniform vec2 worldSize;
layout(location = 0) out highp vec4 outColor;

float sdBox(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// Distance to the line through a, positive on the side the normal n points to.
float side(vec2 p, vec2 a, vec2 n) { return dot(p - a, n) / length(n); }
// A chevron pointing ahead, its apex at x = a, t thick along the axis, its arms sloping back by 0.9 per unit of beam.
float chev(vec2 q, float a, float t) { return min(a - q.x - 0.9 * q.y, q.x - a + t + 0.9 * q.y) * 0.7433; }
// The marker of each kind, positive inside, in marker lengths, the bow at x = 0.5:
// a diamond for the trade ship, a double chevron for the transport, a slim notched dart for the warship.
// The caps across the bow and the stern keep the halo and the hairline from spiking off the sharp points.
float marker(vec2 q, float W) {
  float d = min(0.5 - q.x, q.x + 0.5);
  if (vKind > 1.5) return min(d, min(side(q, vec2(0.5, 0.0), vec2(-W, -1.0)), side(q, vec2(-0.28, 0.0), vec2(W, 0.22))));
  if (vKind > 0.5) return min(W - q.y, max(chev(q, 0.5, 0.27), chev(q, 0.14, 0.27)));
  return min(d, min(side(q, vec2(0.5, 0.0), vec2(-W, -0.62)), side(q, vec2(-0.5, 0.0), vec2(W, -0.38))));
}

vec3 PC; float PA;
void lay(vec3 c, float a) { a = clamp(a, 0.0, 1.0); PC = PC * (1.0 - a) + c * a; PA = PA * (1.0 - a) + a; }

void main() {
  float aa = tilesPerPixel / vL, det = vDet;
  vec3 own = vCol, white = vec3(0.97, 0.98, 1.0), ink = vec3(0.03, 0.05, 0.09);
  // Far away a slim marker is fattened to a beam of a few pixels, so that the colour reads.
  float W = vKind > 1.5 ? 0.19 : (vKind > 0.5 ? 0.34 : 0.27);
  W = mix(max(W, (vKind > 1.5 ? 7.0 : 7.5) * aa), W, det);
  vec2 p = vLoc, q = vec2(p.x, abs(p.y));
  PC = vec3(0.0); PA = 0.0;

  // Wake: a line of dots fixed to the sea, so that they stay where the ship passed, cut at the shore.
  float s = -0.5 - p.x;
  if (vSpeed > 0.02 && s > 0.06) {
    float r = max(0.022, 1.1 * aa) * (1.0 - 0.35 * s);
    float dd = length(vec2((fract(dot(vWorld, vDir) / vL * 5.0) - 0.5) * 0.2, p.y)) - r;
    float wk = (1.0 - smoothstep(-aa * 0.5, aa * 0.5, dd)) * (1.0 - smoothstep(0.3, 1.45, s)) * vSpeed * 0.8;
    if (wk > 0.003) {
      wk *= 1.0 - smoothstep(0.35, 0.65, textureLod(land, vWorld / worldSize, 0.0).r);
      lay(mix(own, white, 0.7), wk);
    }
  }

  float d = marker(q, W);
#ifndef FLAT
  // A faint halo of the owner's colour, faint enough that a crowd of ships does not blur into one glow.
  lay(own, exp(-max(-d, 0.0) / (aa + 0.006)) * 0.2);
#endif
  // A dark hairline outside the rim, for the light sea and the light colours.
  lay(ink, clamp(1.6 + d / aa, 0.0, 1.0) * 0.5);

  float inside = clamp(0.5 + d / aa, 0.0, 1.0);
  if (inside > 0.0) {
    // The owner's colour whole, never dimmed, inside a light rim.
    float rim = mix(1.5, 2.0, det) * aa;
    vec3 col = mix(mix(own, white, 0.7), own, smoothstep(rim, rim + aa, d));
    // Up close, a glyph per kind: white, or dark on a light colour.
    float gw = max(0.012, 0.9 * aa), g;
    if (vKind > 1.5) g = min(sdBox(p, vec2(0.02, 0.0), vec2(0.30, 0.0)), sdBox(p, vec2(0.05, 0.0), vec2(0.0, W * 0.4))) - gw;
    else if (vKind > 0.5) g = max(min(abs(chev(q, 0.365, 0.0)), abs(chev(q, 0.005, 0.0))) - gw, q.y - W * 0.6);
    else g = max(sdBox(vec2(mod(p.x + 0.20, 0.16) - 0.08, p.y), vec2(0.0), vec2(0.05, W * 0.36)), sdBox(p, vec2(-0.04, 0.0), vec2(0.24, 1.0)));
    vec3 glyph = dot(own, vec3(0.2126, 0.7152, 0.0722)) > 0.55 ? ink : white;
    col = mix(col, glyph, (1.0 - smoothstep(-aa * 0.5, aa * 0.5, g)) * smoothstep(0.0, 0.6, det));
    lay(col, inside);
  }

  // A warship that has just fired: a flash at the bow and a ring of light round the dart.
  // With motion reduced the flash is left out and the ring only glows, softer.
  if (vFlash > 0.001 && vKind > 1.5) {
    float gr = max(0.08, 6.0 * aa);
    vec2 m = p - vec2(0.3, 0.0);
    lay(vec3(1.0, 0.86, 0.5), exp(-dot(m, m) / (gr * gr)) * vFlash * (reduced > 0.5 ? 0.0 : 0.95));
    lay(vec3(1.0, 0.95, 0.78), (1.0 - smoothstep(0.0, 2.0 * aa + 0.006, abs(d + 2.0 * aa))) * vFlash * (reduced > 0.5 ? 0.4 : 0.75));
  }

  // Fade out at the border of the quad so that the halo and the wake never show a seam.
  float edgeFade = (1.0 - smoothstep(1.7, 1.85, -p.x)) * (1.0 - smoothstep(0.44, 0.5, abs(p.y)));
  PA *= edgeFade;
  if (PA < 0.002) discard;
  outColor = vec4(PC * edgeFade, PA);
}`;

/** The colour of `#RRGGBB` as sRGB red, green and blue in 0 to 1: the shader paints in sRGB and writes it out as it is. */
function srgb(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * Every hull of the map in one instanced draw call. Positions are in tiles;
 * the vertex shader moves each hull next to the camera across the east-west
 * seam. The shore is a mask of the water, so that no wake crosses land.
 */
export class ShipLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly position: THREE.InstancedBufferAttribute;
  private readonly angle: THREE.InstancedBufferAttribute;
  private readonly kind: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly landTexture: THREE.DataTexture;
  private readonly cameraX = { value: 0 };
  private readonly tilesPerPixel = { value: 1 };
  private readonly reduced = { value: 0 };
  private dirty = false;

  constructor(readonly options: ShipLayerOptions) {
    const { capacity, worldWidth, worldHeight } = options;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (size: number): THREE.InstancedBufferAttribute => {
      const made = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      made.setUsage(THREE.DynamicDrawUsage);
      return made;
    };
    this.position = attribute(2);
    this.angle = attribute(1);
    this.kind = attribute(4);
    this.color = attribute(3);
    geometry.setAttribute("iPos", this.position);
    geometry.setAttribute("iAng", this.angle);
    geometry.setAttribute("iKind", this.kind);
    geometry.setAttribute("iCol", this.color);
    geometry.instanceCount = 0;

    // 255 on land, 0 at sea, filtered linearly so that the shore is soft under the wake.
    const mask = new Uint8Array(worldWidth * worldHeight);
    for (let i = 0; i < mask.length; i++) mask[i] = options.kinds[i] === 0 ? 0 : 255;
    this.landTexture = new THREE.DataTexture(mask, worldWidth, worldHeight, THREE.RedFormat);
    this.landTexture.internalFormat = "R8";
    this.landTexture.magFilter = THREE.LinearFilter;
    this.landTexture.minFilter = THREE.LinearFilter;
    this.landTexture.generateMipmaps = false;
    this.landTexture.unpackAlignment = 1;
    this.landTexture.wrapS =
      options.wrapsX === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    this.landTexture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: options.flat ? { FLAT: 1 } : {},
      vertexShader,
      fragmentShader,
      uniforms: {
        worldWidth: { value: worldWidth },
        worldHeight: { value: worldHeight },
        worldSize: { value: new THREE.Vector2(worldWidth, worldHeight) },
        wrapsX: { value: options.wrapsX ?? true },
        cameraX: this.cameraX,
        tilesPerPixel: this.tilesPerPixel,
        phone: { value: options.phone ? PHONE_FACTOR : 1 },
        detail: { value: new THREE.Vector2(DETAIL_FROM, DETAIL_TO) },
        reduced: this.reduced,
        land: { value: this.landTexture },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  get count(): number {
    return this.mesh.geometry.instanceCount;
  }

  /** Replaces every hull; the caller orders them, so that the later ones are drawn over the earlier. */
  setHulls(hulls: readonly Hull[]): void {
    const count = Math.min(hulls.length, this.options.capacity);
    for (let i = 0; i < count; i++) {
      const hull = hulls[i] as Hull;
      this.position.setXY(i, hull.x, hull.y);
      this.angle.setX(i, hull.heading);
      this.kind.setXYZW(
        i,
        KIND_ID[hull.kind],
        hull.flash ?? 0,
        Math.min(1, hull.speed / FULL_SPEED),
        hull.seed,
      );
      const [r, g, b] = srgb(hull.color);
      this.color.setXYZ(i, r, g, b);
    }
    this.mesh.geometry.instanceCount = count;
    this.dirty = true;
  }

  /** Whether the player accepts motion; held still, a warship's shot no longer flashes. */
  setMotion(moving: boolean): void {
    this.reduced.value = moving ? 0 : 1;
  }

  /** Follows the camera, and uploads the hulls set since the last call; the markers do not depend on the clock. */
  update(_time: number, cameraX: number, tilesPerPixel: number): void {
    this.cameraX.value = cameraX;
    this.tilesPerPixel.value = tilesPerPixel;
    if (!this.dirty) return;
    this.dirty = false;
    for (const attribute of [this.position, this.angle, this.kind, this.color]) {
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.landTexture.dispose();
  }
}
