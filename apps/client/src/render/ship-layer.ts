import * as THREE from "three";

/**
 * Ships as modern vessels seen from above (docs/art-direction.md, Ships): one
 * instanced quad per ship, the hull, its deck and superstructure, its shadow,
 * its bow wave and its wake all computed per pixel. No bitmap. Kept out of
 * the first visit with the other map layers (lazy.ts).
 */

export type ShipKind = "trade" | "transport" | "warship";

const KIND_ID: Record<ShipKind, number> = { trade: 0, transport: 1, warship: 2 };

/**
 * Length of each hull in tiles, and its smallest length on screen in CSS
 * pixels: a hull never shrinks below a readable ship, and the type is read
 * from the silhouette (a stout container ship, a flat-topped assault ship,
 * a slim destroyer). The vertex shader holds the same figures.
 */
export const HULL_SIZES = {
  trade: { tiles: 1.6, minPixels: 28 },
  transport: { tiles: 2.5, minPixels: 33 },
  warship: { tiles: 3.5, minPixels: 46 },
} as const;

/** On a phone the floor is a little larger, and so is everything the finger has to find. */
const PHONE_FACTOR = 1.12;
/** Between these lengths on screen, in CSS pixels, a hull passes from the far silhouette to its true proportions, deck and superstructure. */
const DETAIL_FROM = 10;
const DETAIL_TO = 27;
/** Between these, the small things come in: the cells of the launchers, the deck markings, the ribs of the containers. */
const FINE_FROM = 48;
const FINE_TO = 110;
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
  /** The light picture of the Saver profile: no relief, no shadow, no foam noise. */
  readonly flat?: boolean;
  /** A phone, which asks for larger hulls. */
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
  /** Tells two hulls apart, for the colours of their containers and the rhythm of their foam. */
  readonly seed: number;
}

const vertexShader = /* glsl */ `
in vec2 iPos; in float iAng; in vec4 iKind; in vec3 iCol;
uniform float worldWidth; uniform float worldHeight; uniform float cameraX; uniform bool wrapsX;
uniform float tilesPerPixel; uniform float phone; uniform vec4 detail;
out vec2 vLoc; out vec2 vWorld; flat out float vL; flat out float vKind; flat out vec3 vCol; flat out vec2 vSt; flat out float vAng; flat out vec2 vDet; flat out float vFlash;
void main() {
  float kind = iKind.x;
  vec2 hull = kind < 0.5 ? vec2(1.6, 28.0) : (kind < 1.5 ? vec2(2.5, 33.0) : vec2(3.5, 46.0));
  float L = max(hull.x, hull.y * phone * tilesPerPixel);
  // A tight quad: the hull and its bow wave, and behind a moving ship its wake.
  vec2 loc = vec2(mix(iKind.z > 0.02 ? -1.75 : -0.6, 0.62, position.x + 0.5), position.y * 1.24);
  float c = cos(iAng), s = sin(iAng);
  vec2 centre = iPos + 0.5;
  vec4 at = modelMatrix * vec4(centre.x, worldHeight - centre.y, 0.0, 1.0);
  // The copy of the world nearest the camera, judged by the centre so that no hull is torn at the seam.
  float shift = wrapsX ? worldWidth * floor((cameraX - at.x) / worldWidth + 0.5) : 0.0;
  vec2 w = centre + vec2(c * loc.x - s * loc.y, s * loc.x + c * loc.y) * L;
  vLoc = loc; vWorld = w; vL = L; vKind = kind; vCol = iCol; vSt = iKind.zw; vAng = iAng; vFlash = iKind.y;
  float px = L / tilesPerPixel;
  vDet = vec2(smoothstep(detail.x, detail.y, px), smoothstep(detail.z, detail.w, px));
  vec4 world = modelMatrix * vec4(w.x, worldHeight - w.y, 0.2, 1.0);
  world.x += shift;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
precision highp float;
in vec2 vLoc; in vec2 vWorld; flat in float vL; flat in float vKind; flat in vec3 vCol; flat in vec2 vSt; flat in float vAng; flat in vec2 vDet; flat in float vFlash;
uniform float time; uniform float reduced; uniform vec2 light; uniform float tilesPerPixel;
uniform sampler2D land; uniform vec2 worldSize;
layout(location = 0) out highp vec4 outColor;

float AA;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
#ifdef FLAT
  return vn(p);
#else
  return vn(p) * 0.62 + vn(p * 2.13 + 7.3) * 0.38;
#endif
}
float sdBox(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// A box with its four corners cut by k: the faceted blocks of a modern superstructure.
float sdCut(vec2 p, vec2 c, vec2 h, float k) { vec2 d = abs(p - c); return max(sdBox(p, c, h), (d.x + d.y - h.x - h.y + k) * 0.7071); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// Coverage of a shape from its distance, one pixel soft.
float F(float d) { return clamp(0.5 - d / AA, 0.0, 1.0); }
// Coverage of its outline, w thick.
float E(float d, float w) { return F(abs(d) - w); }

// Half beam, where the bow starts, how it curves, how wide the transom is:
// a container ship, an amphibious assault ship, a destroyer.
vec4 hullP(float k) {
  if (k < 0.5) return vec4(0.090, 0.72, 2.6, 0.93);
  if (k < 1.5) return vec4(0.100, 0.66, 1.9, 0.97);
  return vec4(0.066, 0.42, 1.5, 0.80);
}
float hullW(float t, vec4 hp) {
  float stern = mix(hp.w, 1.0, smoothstep(0.0, 0.2, t));
  float b = clamp((t - hp.y) / (1.0 - hp.y), 0.0, 1.0);
  return hp.x * stern * (1.0 - pow(b, hp.z));
}
float hullD(vec2 p, vec4 hp) {
  float t = p.x + 0.5, tc = clamp(t, 0.0, 1.0);
  float hw = hullW(tc, hp), e = 0.012;
  float sl = (hullW(min(tc + e, 1.0), hp) - hullW(max(tc - e, 0.0), hp)) / (2.0 * e);
  float d = (hw - abs(p.y)) / sqrt(1.0 + sl * sl);
  return min(d, min(t, (1.0 - t) * 0.8));
}
// What stands above the deck, as a distance (negative inside): it throws its shadow on the deck.
float upper(vec2 p, float k) {
  vec2 q = vec2(p.x, abs(p.y));
  if (k < 0.5) return min(sdBox(q, vec2(-0.352, 0.0), vec2(0.03, 0.104)), sdCut(q, vec2(-0.425, 0.0), vec2(0.024, 0.034), 0.012));
  if (k < 1.5) return sdCut(p, vec2(0.0, 0.07), vec2(0.12, 0.026), 0.014);
  return min(min(sdCut(q, vec2(0.035, 0.0), vec2(0.105, 0.040), 0.026), sdBox(q, vec2(-0.205, 0.0), vec2(0.085, 0.045))),
    sdCut(q, vec2(0.30, 0.0), vec2(0.03, 0.022), 0.014));
}

vec3 PC; float PA;
void lay(vec3 c, float a) { a = clamp(a, 0.0, 1.0); PC = PC * (1.0 - a) + c * a; PA = PA * (1.0 - a) + a; }

void main() {
  float L = vL, det = vDet.x, fine = vDet.y;
  AA = tilesPerPixel / L;
  float aa = AA;
  float speed = vSt.x, seed = vSt.y;
  vec3 own = vCol;
  vec4 hp = hullP(vKind);
  // Small on screen, the whole ship is drawn broader, deck and all, so that its colour and its
  // superstructure read; it takes its true slender lines as it grows. The beam on screen still
  // tells the types apart: a slim warship, a stout trade ship.
  float farBeam = vKind > 1.5 ? 8.0 : (vKind > 0.5 ? 10.0 : 9.5);
  float boost = max(1.0, farBeam * tilesPerPixel / (2.0 * hp.x * L));
  PC = vec3(0.0); PA = 0.0;
  vec2 p = vec2(vLoc.x, vLoc.y / boost);
  float t = p.x + 0.5;
  vec2 wp = vWorld / L;
  float drift = reduced > 0.5 ? 0.0 : time * 0.07;
  vec2 lightL = vec2(dot(light, vec2(cos(vAng), sin(vAng))), dot(light, vec2(-sin(vAng), cos(vAng))));
  float W = hp.x;

  // Wake: the two arms of a Kelvin wake that widen and fade, a churned core of propeller wash, fixed to the sea.
  float s = -0.5 - p.x;
  if (speed > 0.02 && s > -0.06 && s < 1.6 && abs(p.y) < W * 0.85 + 0.3 * s + 0.09) {
    float edge = W * 0.85 + 0.27 * s;
    float a = abs(abs(p.y) - edge);
    float armW = max(0.012 + 0.045 * s, 1.6 * aa);
    float arm = 1.0 - smoothstep(0.0, armW, a);
    float n = fbm(wp * 15.0 + vec2(drift, -drift));
    arm *= smoothstep(0.10, 0.45, n + 0.12 * sin(s * 30.0 + seed * 6.0));
    float fade = exp(-s * 3.0) * smoothstep(-0.06, 0.05, s) * (1.0 - smoothstep(0.6, 1.3, s));
    float cw = W * 0.7 * (1.0 + 0.5 * s);
    float core = (1.0 - smoothstep(0.0, cw, abs(p.y))) * exp(-s * 2.6) * (1.0 - smoothstep(0.7, 1.4, s));
    core *= smoothstep(0.18, 0.5, vn(wp * 21.0 + 3.0 + vec2(drift)) + 0.28);
    // The wash right behind the stern is churned turquoise before it whitens.
    lay(vec3(0.36, 0.62, 0.66), core * smoothstep(-0.06, 0.02, s) * (1.0 - smoothstep(0.0, 0.5, s)) * 0.5 * speed * det);
    float fill = (1.0 - smoothstep(edge * 0.2, edge, abs(p.y))) * exp(-s * 2.8) * 0.3 * n;
    float wk = clamp(arm * fade + core * smoothstep(-0.06, 0.04, s) + fill, 0.0, 1.0) * speed;
    // Never over the shore: the wake of a ship that skirts a coast stops at the sand.
    wk *= 1.0 - smoothstep(0.35, 0.65, textureLod(land, vWorld / worldSize, 0.0).r);
    lay(vec3(0.93, 0.97, 1.0), wk * mix(0.4, 0.75, fine));
  }

  float d = hullD(p, hp);

#ifndef FLAT
  // Shadow on the water, falling away from the light, longer under the superstructure.
  if (det > 0.1) {
    float ds = max(hullD(p + lightL * 0.035, hp), -upper(p + lightL * 0.07, vKind) - 0.004);
    lay(vec3(0.0, 0.03, 0.07), smoothstep(-0.03, 0.03, ds) * 0.45 * det * step(d, 0.0));
  }
#endif

  // Foam at the waterline and the V of the bow wave.
  float tt = clamp(t, 0.0, 1.0);
  float foamW = 0.006 + 0.045 * speed * smoothstep(0.30, 1.0, tt);
  float fo = (1.0 - smoothstep(foamW * 0.5, foamW, -d)) * step(d, 0.0);
  float fn = vn(wp * 26.0 + vec2(drift * 2.0, 0.0));
  vec2 p2 = vec2(p.x, abs(p.y));
  float da = sdSeg(p2, vec2(0.49, 0.0), vec2(0.2, W * 1.06 + 0.012));
  float bowArm = (1.0 - smoothstep(0.0, 0.010 + 0.010 * (0.5 - p.x) + aa, da)) * smoothstep(-0.05, 0.25, p.x) * speed * smoothstep(0.1, 0.5, fn + 0.3);
  lay(vec3(0.96, 0.985, 1.0), clamp(fo * smoothstep(0.25, 0.6, fn + 0.28) * mix(1.0, 0.55, det) + bowArm * mix(0.25, 0.75, fine), 0.0, 1.0) * (0.5 + 0.5 * det));
  // A pale rim of the owner's colour round the hull, since the dark sea would swallow its outline,
  // brighter round a warship, which must stand out; and outside it a faint halo of that colour.
  float ringA = vKind > 1.5 ? 0.95 : 0.75;
#ifndef FLAT
  lay(own, exp(-max(-d, 0.0) / (aa * 2.5 + 0.004)) * 0.22 * step(d, 0.0));
#endif
  lay(mix(own, vec3(1.0), 0.6), (1.0 - smoothstep(0.0, mix(1.8, 1.2, fine) * aa, -d)) * step(d, 0.0) * ringA);

  float inside = F(-d);
  if (inside > 0.0) {
    // Light from the top left: the deck bends down at the gunwale, so the edge on the light side shines.
    float lam = 0.9;
#ifndef FLAT
    if (det > 0.02) {
      float e0 = 0.008;
      vec2 g = vec2(hullD(p + vec2(e0, 0.0), hp) - hullD(p - vec2(e0, 0.0), hp), hullD(p + vec2(0.0, e0), hp) - hullD(p - vec2(0.0, e0), hp)) / (2.0 * e0);
      float rim = 1.0 - smoothstep(0.0, 0.03, d);
      vec3 N = normalize(vec3(-g * rim * 1.4, 1.0));
      lam = clamp(dot(N, normalize(vec3(lightL, 0.75))), 0.0, 1.2);
    }
#endif
    vec3 ink = vec3(0.04, 0.06, 0.09);
    vec3 grey = vec3(0.62, 0.66, 0.69), light2 = vec3(0.84, 0.86, 0.87), dark = vec3(0.16, 0.18, 0.21), white = vec3(0.94, 0.95, 0.94);
    float u = p.x, v = p.y;
    vec2 q = vec2(u, abs(v));
    // The side of the hull seen from above: a band of the owner's colour along the gunwale.
    float band = 1.0 - smoothstep(0.012, 0.012 + aa, d);
    vec3 col = own;
    float up = upper(p, vKind);
    // Shadow of the superstructure on the deck.
    float sh = 0.0;
#ifndef FLAT
    sh = (1.0 - smoothstep(-0.004, 0.012, upper(p + lightL * 0.03, vKind))) * step(0.0, up) * 0.42 * det;
#endif
    if (det < 0.02) {
    } else if (vKind > 1.5) {
      // Destroyer: a deck in the owner's colour, toned down like naval paint, under faceted grey blocks.
      vec3 deck = mix(own, grey, 0.14);
      col = mix(deck, own, band);
      // The breakwater on the forecastle, and the darker non-slip walkway down the middle.
      col = mix(col, deck * 0.72, E(sdSeg(q, vec2(0.36, 0.0), vec2(0.33, 0.05)), 0.003) * det);
      col = mix(col, deck * 0.9, F(sdBox(q, vec2(0.0, 0.0), vec2(0.42, 0.012))) * fine * 0.6);
      // Forward launcher: a grid of cells.
      float vls = sdBox(q, vec2(0.205, 0.0), vec2(0.032, 0.03));
      col = mix(col, dark * 1.3, F(vls) * det);
      vec2 cell = vec2(mod(u - 0.173, 0.016) - 0.008, mod(v + 0.03, 0.015) - 0.0075);
      col = mix(col, dark * 0.6, F(sdBox(cell, vec2(0.0), vec2(0.005, 0.0045))) * F(vls) * fine);
      // Main gun: a faceted turret and its barrel.
      float tur = sdCut(q, vec2(0.30, 0.0), vec2(0.03, 0.022), 0.014);
      col = mix(col, light2 * 0.85, F(sdSeg(p, vec2(0.32, 0.0), vec2(0.405, 0.0)) - 0.0045) * det);
      col = mix(col, light2, F(tur) * det);
      col = mix(col, grey * 0.8, F(tur + 0.012) * fine * 0.6);
      col = mix(col, ink, E(tur, 0.0015) * 0.5 * fine);
      // Bridge block, faceted, with the mast and its radar faces.
      float br = sdCut(q, vec2(0.035, 0.0), vec2(0.105, 0.040), 0.026);
      col = mix(col, light2, F(br) * det);
      col = mix(col, ink * 2.0, F(sdBox(q, vec2(0.123, 0.0), vec2(0.007, 0.026))) * det);
      float mast = sdCut(q, vec2(0.045, 0.0), vec2(0.03, 0.026), 0.014);
      col = mix(col, white, F(mast) * det);
      col = mix(col, grey * 0.7, E(mast, 0.002) * fine);
      col = mix(col, dark, F(length(q - vec2(0.045, 0.0)) - 0.009) * fine);
      // Funnel, hangar and the boats in their davits on each side.
      float hg = sdBox(q, vec2(-0.205, 0.0), vec2(0.085, 0.045));
      col = mix(col, light2 * 0.96, F(hg) * det);
      col = mix(col, grey * 0.8, F(sdBox(q, vec2(-0.165, 0.0), vec2(0.01, 0.045))) * fine * 0.6);
      float fu = sdCut(q, vec2(-0.105, 0.0), vec2(0.026, 0.024), 0.012);
      col = mix(col, grey * 0.78, F(fu) * det);
      col = mix(col, ink, F(sdBox(q, vec2(-0.105, 0.0), vec2(0.014, 0.012))) * det);
      col = mix(col, white * 0.95, F(sdBox(q, vec2(-0.105, 0.053), vec2(0.022, 0.007)) - 0.003) * fine);
      // Helicopter deck: dark, a white circle and line, a band of the owner's colour on the transom.
      float hd = sdBox(q, vec2(-0.395, 0.0), vec2(0.105, 0.062));
      col = mix(col, dark * 1.35, F(hd) * (1.0 - band) * det);
      col = mix(col, white, E(length(q - vec2(-0.385, 0.0)) - 0.034, 0.0028) * fine);
      col = mix(col, white, F(sdBox(q, vec2(-0.385, 0.0), vec2(0.044, 0.0022))) * fine);
      col = mix(col, own * 1.1, F(sdBox(q, vec2(-0.49, 0.0), vec2(0.012, 0.06))) * det);
      col = mix(col, ink, (E(br, 0.0016) + E(hg, 0.0016)) * 0.45 * det);
    } else if (vKind > 0.5) {
      // Amphibious assault ship: a flight deck end to end, toned with the owner's colour, an island to starboard.
      vec3 deck = mix(vec3(0.26, 0.28, 0.30), own, 0.72);
      col = mix(deck, own, band);
      // Deck markings: a dashed centre line, the landing spots along the port side, the deck edge line.
      float dash = step(0.5, fract(u * 22.0));
      col = mix(col, white, F(sdBox(p, vec2(-0.02, -0.01), vec2(0.42, mix(0.007, 0.0025, fine)))) * mix(0.55, dash, fine) * det);
      for (int i = 0; i < 4; i++) {
        vec2 c = vec2(0.24 - float(i) * 0.17, -0.045);
        col = mix(col, vec3(0.98, 0.85, 0.35), E(length(p - c) - 0.026, 0.0024) * fine);
      }
      // Two helicopters parked on the spots, rotors folded into an X.
      for (int i = 0; i < 2; i++) {
        vec2 c = p - vec2(i == 0 ? 0.24 : -0.27, -0.045);
        float body = sdSeg(c, vec2(-0.028, 0.0), vec2(0.016, 0.0)) - 0.009;
        float tail = sdSeg(c, vec2(-0.06, 0.0), vec2(-0.02, 0.0)) - 0.0025;
        col = mix(col, vec3(0.30, 0.34, 0.30), F(min(body, tail)) * det);
        float rot = min(sdSeg(c, vec2(-0.03, -0.03), vec2(0.03, 0.03)), sdSeg(c, vec2(-0.03, 0.03), vec2(0.03, -0.03))) - 0.0018;
        col = mix(col, ink, F(rot) * fine * 0.8);
      }
      // The aircraft lift cut in the deck edge, aft of the island.
      col = mix(col, dark, F(sdBox(p, vec2(-0.24, 0.08), vec2(0.04, 0.02))) * det * 0.7);
      // The island: faceted, light, with the bridge windows and the radar mast.
      float isl = sdCut(p, vec2(0.0, 0.07), vec2(0.12, 0.026), 0.014);
      col = mix(col, white, F(isl) * det);
      col = mix(col, ink * 2.0, F(sdBox(p, vec2(0.105, 0.072), vec2(0.005, 0.016))) * det);
      col = mix(col, grey * 0.75, F(sdCut(p, vec2(-0.05, 0.072), vec2(0.024, 0.014), 0.008)) * det);
      col = mix(col, white, F(length(p - vec2(0.03, 0.072)) - 0.012) * det);
      col = mix(col, dark, F(length(p - vec2(0.03, 0.072)) - 0.004) * fine);
      col = mix(col, ink, E(isl, 0.0016) * 0.5 * det);
      // The well deck gate at the stern.
      col = mix(col, dark, F(sdBox(p, vec2(-0.49, 0.0), vec2(0.012, 0.065))) * det);
    } else {
      // Container ship: a hull in the owner's colour, rows of containers, the bridge and the funnel aft.
      col = mix(mix(vec3(0.22, 0.23, 0.25), own, 0.4), own, band);
      // Forecastle with its winches, painted the owner's colour like the hull.
      col = mix(col, own * 0.8, F(0.355 - u) * det * (1.0 - band));
      col = mix(col, dark, F(length(q - vec2(0.42, 0.03)) - 0.01) * fine);
      for (int i = 0; i < 7; i++) {
        float x0 = 0.31 - float(i) * 0.088;
        for (int j = 0; j < 4; j++) {
          vec2 cc = vec2(x0, (float(j) - 1.5) * 0.034);
          float hsh = h21(vec2(float(i) * 1.7 + seed, float(j) * 2.9 + seed * 0.3));
          vec3 cn = hsh < 0.42 ? own : (hsh < 0.54 ? vec3(0.70, 0.22, 0.16) : (hsh < 0.66 ? vec3(0.18, 0.36, 0.60) : (hsh < 0.78 ? vec3(0.80, 0.80, 0.78) : (hsh < 0.89 ? vec3(0.22, 0.48, 0.32) : vec3(0.85, 0.55, 0.18)))));
          // Now and then a stack missing, away from the middle of the ship.
          float gone = step(0.93, h21(vec2(float(i) + seed * 3.0, float(j) + 7.0))) * step(0.5, abs(float(i) - 3.0) - 1.5);
          float cd = sdBox(vec2(u, v), cc, vec2(0.041, 0.0155));
          float rib = 0.9 + 0.12 * step(0.5, fract((u - cc.x) * 160.0)) * fine;
          vec3 cs = cn * rib * (0.85 + 0.25 * smoothstep(0.016, -0.016, v - cc.y));
          col = mix(col, cs, F(cd) * det * (1.0 - gone));
        }
      }
      // Bridge with its wings out over the sides, windows forward, and a funnel in the owner's livery.
      float brd = sdBox(q, vec2(-0.352, 0.0), vec2(0.03, 0.104));
      col = mix(col, white, F(brd) * det);
      col = mix(col, ink * 2.0, F(sdBox(q, vec2(-0.326, 0.0), vec2(0.004, 0.09))) * det);
      col = mix(col, grey, F(sdBox(q, vec2(-0.36, 0.0), vec2(0.012, 0.05))) * fine * 0.6);
      float fu = sdCut(q, vec2(-0.425, 0.0), vec2(0.024, 0.034), 0.012);
      col = mix(col, own, F(fu) * det);
      col = mix(col, white, F(sdBox(q, vec2(-0.425, 0.0), vec2(0.0045, 0.034))) * det);
      col = mix(col, ink, F(sdBox(q, vec2(-0.432, 0.0), vec2(0.008, 0.02))) * det);
      col = mix(col, ink, (E(brd, 0.0016) + E(fu, 0.0016)) * 0.5 * det);
    }
    col *= 1.0 - sh;
    col = mix(own, col, det);
    float shade = 0.72 + 0.42 * lam;
    col *= mix(0.84 + 0.3 * lam, shade, det);
    // A dark edge, thinner as you come closer.
    float ow = mix(1.4, 0.9, det) * aa;
    col = mix(col, ink, (1.0 - smoothstep(ow, ow + aa, d)) * 0.35);
    lay(col, inside);
  }

  // A warship that has just fired: its gun flashes and a ring of light runs round the hull.
  // With motion reduced the flash is left out and the ring only glows, softer and still.
  if (vFlash > 0.001 && vKind > 1.5) {
    float soft = reduced > 0.5 ? 0.5 : 1.0;
    float gr = max(0.08, 7.0 * aa);
    vec2 m = p - vec2(0.42, 0.0);
    float halo = (1.0 - smoothstep(0.0, 2.0 * aa + 0.006, abs(d - 0.01))) * smoothstep(-0.1, 0.1, p.x + 0.55);
    lay(vec3(1.0, 0.86, 0.5), exp(-dot(m, m) / (gr * gr)) * vFlash * (reduced > 0.5 ? 0.0 : 0.95));
    lay(vec3(1.0, 0.95, 0.78), halo * vFlash * 0.75 * soft);
  }

  // Fade out at the border of the quad so that a wide wake never shows a seam.
  float edgeFade = (1.0 - smoothstep(1.55, 1.75, -p.x)) * (1.0 - smoothstep(0.52, 0.62, abs(p.y)));
  PC *= edgeFade; PA *= edgeFade;
  if (PA < 0.002) discard;
  outColor = vec4(PC, PA);
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
  private readonly time = { value: 0 };
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
        detail: { value: new THREE.Vector4(DETAIL_FROM, DETAIL_TO, FINE_FROM, FINE_TO) },
        time: this.time,
        reduced: this.reduced,
        light: { value: new THREE.Vector2(-0.55, -0.65).normalize() },
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

  /** Whether the player accepts motion; held still, the foam keeps its place but no longer drifts, and a shot no longer flashes. */
  setMotion(moving: boolean): void {
    this.reduced.value = moving ? 0 : 1;
  }

  /** Follows the clock and the camera, and uploads the hulls set since the last call. */
  update(time: number, cameraX: number, tilesPerPixel: number): void {
    this.time.value = time;
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
