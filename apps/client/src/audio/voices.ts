/*
 * The instruments of the sound design: small recipes of oscillators, noise and
 * filters that make one note or one hit. Everything is synthesised, so no file
 * is fetched and nothing needs a credit. Each recipe takes the random source it
 * draws its little differences from, so two hits are never quite alike.
 */

/** A random source returning numbers in [0, 1). */
export type Rng = () => number;

/** A small, fast generator whose output depends only on its seed. */
export function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frequency in hertz of a MIDI note number. */
export function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A number in [-1, 1], leaning toward 0. */
function spread(rnd: Rng): number {
  return rnd() + rnd() - 1;
}

const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, made once per context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rnd = seeded(7);
    for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
    noises.set(ctx, buffer);
  }
  return buffer;
}

/** The impulse response of a room: noise that fades and darkens, a little different on each side. */
export function roomImpulse(ctx: BaseAudioContext, seconds: number, dark: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const rnd = seeded(101 + channel * 17);
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // The air takes the highs first: the filter closes as the tail goes on.
      const k = Math.max(0.04, 1 - t * dark);
      low += (rnd() * 2 - 1 - low) * k;
      data[i] = low * (1 - t) ** 2.4;
    }
  }
  return buffer;
}

/** Fades a gain in over `attack` seconds to `peak`, then lets it fall with the time constant `tau`. */
function pluckEnvelope(
  gain: AudioParam,
  at: number,
  peak: number,
  attack: number,
  tau: number,
): number {
  gain.setValueAtTime(0, at);
  gain.linearRampToValueAtTime(peak, at + attack);
  gain.setTargetAtTime(0, at + attack, tau);
  return at + attack + tau * 7;
}

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
  at: number,
  detune = 0,
): OscillatorNode {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  node.detune.value = detune;
  node.start(at);
  return node;
}

/** A burst of noise through one filter, with its own envelope. */
export function noiseHit(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  rnd: Rng,
  options: {
    type: BiquadFilterType;
    from: number;
    to?: number;
    q?: number;
    level: number;
    attack?: number;
    tau: number;
  },
): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = options.type;
  filter.Q.value = options.q ?? 0.8;
  filter.frequency.setValueAtTime(options.from, at);
  const attack = options.attack ?? 0.004;
  if (options.to !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(options.to, at + attack + options.tau * 3);
  }
  const gain = ctx.createGain();
  const end = pluckEnvelope(gain.gain, at, options.level, attack, options.tau);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, rnd() * 1.5);
  source.stop(end);
}

/** One partial of a struck instrument: a sine with its own level and fade. */
interface Partial {
  ratio: number;
  level: number;
  tau: number;
}

function struck(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  frequency: number,
  velocity: number,
  partials: readonly Partial[],
  rnd: Rng,
): void {
  for (const partial of partials) {
    const f = frequency * partial.ratio;
    if (f > 12000) continue;
    const gain = ctx.createGain();
    const end = pluckEnvelope(gain.gain, at, partial.level * velocity, 0.003, partial.tau);
    const node = osc(ctx, "sine", f, at, spread(rnd) * 3);
    node.connect(gain).connect(out);
    node.stop(end);
  }
}

const MARIMBA: readonly Partial[] = [
  { ratio: 1, level: 1, tau: 0.32 },
  { ratio: 3.93, level: 0.28, tau: 0.09 },
  { ratio: 9.9, level: 0.08, tau: 0.035 },
];

const KALIMBA: readonly Partial[] = [
  { ratio: 1, level: 1, tau: 0.55 },
  { ratio: 5.4, level: 0.22, tau: 0.12 },
  { ratio: 8.9, level: 0.07, tau: 0.05 },
];

const BELL: readonly Partial[] = [
  { ratio: 1, level: 0.8, tau: 1.1 },
  { ratio: 2, level: 0.45, tau: 0.8 },
  { ratio: 2.76, level: 0.5, tau: 0.6 },
  { ratio: 5.4, level: 0.3, tau: 0.35 },
  { ratio: 8.93, level: 0.18, tau: 0.18 },
];

const GLASS: readonly Partial[] = [
  { ratio: 1, level: 0.7, tau: 1.5 },
  { ratio: 2.32, level: 0.35, tau: 0.9 },
  { ratio: 4.25, level: 0.25, tau: 0.6 },
  { ratio: 6.63, level: 0.14, tau: 0.35 },
];

/** An instrument that plays one short note at a time. */
export type Voice = (
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  frequency: number,
  velocity: number,
  rnd: Rng,
) => void;

/** A wooden bar struck with a mallet. */
export const marimba: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  struck(ctx, out, at, frequency, velocity, MARIMBA, rnd);
  noiseHit(ctx, out, at, rnd, {
    type: "bandpass",
    from: Math.min(frequency * 4, 6000),
    q: 1.5,
    level: 0.12 * velocity,
    tau: 0.006,
  });
};

/** A thumb piano: a plucked tine, soft and a little hollow. */
export const kalimba: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  struck(ctx, out, at, frequency, velocity, KALIMBA, rnd);
  noiseHit(ctx, out, at, rnd, {
    type: "bandpass",
    from: Math.min(frequency * 3, 5000),
    q: 2,
    level: 0.07 * velocity,
    tau: 0.005,
  });
};

/** A small bell, bright at first and ringing out. */
export const bell: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  struck(ctx, out, at, frequency, velocity, BELL, rnd);
};

/** A thin glass tone, with a shimmer on top. */
export const glass: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  struck(ctx, out, at, frequency, velocity, GLASS, rnd);
  noiseHit(ctx, out, at, rnd, {
    type: "highpass",
    from: 6000,
    level: 0.04 * velocity,
    tau: 0.03,
  });
};

/** A harp string: a bright start that mellows as the filter closes. */
export const harp: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.5;
  filter.frequency.setValueAtTime(Math.min(frequency * 9, 9000), at);
  filter.frequency.setTargetAtTime(frequency * 1.6, at, 0.12);
  const gain = ctx.createGain();
  const end = pluckEnvelope(gain.gain, at, 0.34 * velocity, 0.002, 0.42);
  filter.connect(gain).connect(out);
  for (const [type, detune, level] of [
    ["triangle", 0, 1],
    ["sawtooth", spread(rnd) * 4, 0.35],
  ] as const) {
    const node = osc(ctx, type, frequency, at, detune);
    const part = ctx.createGain();
    part.gain.value = level;
    node.connect(part).connect(filter);
    node.stop(end);
  }
};

/** A sustained instrument: it holds a note for `seconds`. */
export type Held = (
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  frequency: number,
  seconds: number,
  velocity: number,
  rnd: Rng,
) => void;

/**
 * A bowed ensemble: a few detuned saws, a slow swell and a slow release, with
 * a slight vibrato that starts late as a real section's would.
 */
export const strings: Held = (ctx, out, at, frequency, seconds, velocity, rnd) => {
  const attack = Math.min(0.9, seconds * 0.35);
  const release = Math.min(1.6, seconds * 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.4;
  const cutoff = Math.min(frequency * 3.2, 7000);
  filter.frequency.setValueAtTime(cutoff * 0.5, at);
  filter.frequency.linearRampToValueAtTime(cutoff, at + attack);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.1 * velocity, at + attack);
  gain.gain.setValueAtTime(0.1 * velocity, at + seconds);
  gain.gain.linearRampToValueAtTime(0, at + seconds + release);
  filter.connect(gain).connect(out);
  const vibrato = osc(ctx, "sine", 4.6 + rnd() * 0.8, at);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, at);
  depth.gain.linearRampToValueAtTime(5, at + attack + 0.6);
  vibrato.connect(depth);
  const end = at + seconds + release + 0.05;
  vibrato.stop(end);
  for (const [detune, pan] of [
    [-9, -0.6],
    [-3, -0.2],
    [4, 0.2],
    [10, 0.6],
  ] as const) {
    const node = osc(ctx, "sawtooth", frequency, at, detune + spread(rnd) * 2);
    depth.connect(node.detune);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner).connect(filter);
    node.stop(end);
  }
};

/** A soft pad: sines and triangles an octave apart, slow in and slow out. */
export const pad: Held = (ctx, out, at, frequency, seconds, velocity, rnd) => {
  const attack = Math.min(1.4, seconds * 0.4);
  const release = Math.min(2, seconds * 0.6);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.13 * velocity, at + attack);
  gain.gain.setValueAtTime(0.13 * velocity, at + seconds);
  gain.gain.linearRampToValueAtTime(0, at + seconds + release);
  gain.connect(out);
  const end = at + seconds + release + 0.05;
  for (const [type, ratio, detune, level] of [
    ["sine", 1, -5, 1],
    ["triangle", 1, 6, 0.6],
    ["sine", 2, 0, 0.35],
    ["triangle", 0.5, -2, 0.5],
  ] as const) {
    const node = osc(ctx, type, frequency * ratio, at, detune + spread(rnd) * 2);
    const part = ctx.createGain();
    part.gain.value = level;
    node.connect(part).connect(gain);
    node.stop(end);
  }
};

/** A brass swell: it opens with the filter as it is blown. */
export const brass: Held = (ctx, out, at, frequency, seconds, velocity, rnd) => {
  const attack = Math.min(0.35, seconds * 0.4);
  const release = Math.min(0.9, seconds * 0.6);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(frequency * 1.3, at);
  filter.frequency.linearRampToValueAtTime(Math.min(frequency * 5.5, 6000), at + attack);
  filter.frequency.setTargetAtTime(frequency * 3, at + attack, 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.16 * velocity, at + attack);
  gain.gain.setValueAtTime(0.13 * velocity, at + seconds);
  gain.gain.linearRampToValueAtTime(0, at + seconds + release);
  filter.connect(gain).connect(out);
  const end = at + seconds + release + 0.05;
  for (const [type, detune, level] of [
    ["sawtooth", -6, 1],
    ["sawtooth", 7, 0.8],
    ["square", 0, 0.3],
  ] as const) {
    const node = osc(ctx, type, frequency, at, detune + spread(rnd) * 2);
    const part = ctx.createGain();
    part.gain.value = level;
    node.connect(part).connect(filter);
    node.stop(end);
  }
};

/** A low drum: a sine that drops in pitch, with a dull knock of noise. */
export function drum(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  frequency: number,
  velocity: number,
  rnd: Rng,
  tau = 0.34,
): void {
  const body = osc(ctx, "sine", frequency * 1.5, at);
  body.frequency.setTargetAtTime(frequency, at, 0.045);
  const gain = ctx.createGain();
  const end = pluckEnvelope(gain.gain, at, 0.9 * velocity, 0.002, tau);
  body.connect(gain).connect(out);
  body.stop(end);
  const over = osc(ctx, "sine", frequency * 2.4, at);
  over.frequency.setTargetAtTime(frequency * 1.9, at, 0.06);
  const overGain = ctx.createGain();
  const overEnd = pluckEnvelope(overGain.gain, at, 0.25 * velocity, 0.002, tau * 0.45);
  over.connect(overGain).connect(out);
  over.stop(overEnd);
  noiseHit(ctx, out, at, rnd, {
    type: "lowpass",
    from: 700,
    level: 0.5 * velocity,
    tau: 0.03,
  });
}

/** A knock on wood: a short, dry, hollow tap. */
export const wood: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  const body = osc(ctx, "triangle", frequency, at);
  body.frequency.setTargetAtTime(frequency * 0.7, at, 0.02);
  const gain = ctx.createGain();
  const end = pluckEnvelope(gain.gain, at, 0.5 * velocity, 0.001, 0.045);
  body.connect(gain).connect(out);
  body.stop(end);
  noiseHit(ctx, out, at, rnd, {
    type: "bandpass",
    from: frequency * 2.2,
    q: 3,
    level: 0.35 * velocity,
    tau: 0.012,
  });
};

/** A rising or falling rush of filtered noise. */
export function rush(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  rnd: Rng,
  options: {
    from: number;
    to: number;
    seconds: number;
    level: number;
    q?: number;
    swell?: number;
  },
): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = options.q ?? 1.4;
  filter.frequency.setValueAtTime(options.from, at);
  filter.frequency.exponentialRampToValueAtTime(options.to, at + options.seconds);
  const gain = ctx.createGain();
  const swell = options.swell ?? options.seconds * 0.3;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(options.level, at + swell);
  gain.gain.setTargetAtTime(0, at + swell, (options.seconds - swell) * 0.35 + 0.01);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, rnd() * 1.5);
  source.stop(at + options.seconds + 0.2);
}

/** A slow sub-bass boom, for impacts. */
export const boom: Voice = (ctx, out, at, frequency, velocity, rnd) => {
  drum(ctx, out, at, frequency, velocity, rnd, 0.7);
  noiseHit(ctx, out, at, rnd, {
    type: "lowpass",
    from: 1800,
    to: 120,
    level: 0.35 * velocity,
    tau: 0.22,
  });
};
