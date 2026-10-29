import type { Mix } from "./mix.ts";
import { degree, type Chord, type Palette } from "./palettes.ts";
import { drum, hz, type Rng } from "./voices.ts";

/** How the game feels right now, each from 0 to 1. */
export interface Mood {
  /** 0 in peace, up to 1 with several fronts burning. */
  intensity: number;
  /** 0 with a handful of tiles, up to 1 with an empire. */
  grandeur: number;
}

const BEATS_PER_CHORD = 8;

/** Brings `midi` into [low, low + 12) by whole octaves. */
function fold(midi: number, low: number): number {
  return low + ((((midi - low) % 12) + 12) % 12);
}

/** Rhythms of a phrase, in eighth notes: a number is a note that long, a negative one a rest. */
const RHYTHMS: readonly (readonly number[])[] = [
  [2, 1, 1, 4],
  [1, 1, 2, -1, 3],
  [3, 1, 2, 2],
  [2, 2, 1, 1, 2],
  [1, 2, 1, 4],
];

/**
 * A generative score: chords that change every eight beats and layers that
 * come in and out with the mood. In peace it is a pad and a few soft notes;
 * as the fronts heat up the drums join, and an empire brings in the section.
 * It is made of the same few chords, but the melody, the sparkles and the
 * drums are drawn anew each bar, so it does not loop.
 */
export class Music {
  mood: Mood = { intensity: 0, grandeur: 0 };
  private time = 0;
  private beat = 0;
  private progression = -1;
  private chord: Chord | undefined;
  private chordNumber = 0;
  /** Steps of the scale of the last note of the melody, so that it walks and does not jump. */
  private walker = 2;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly mix: Mix,
    private readonly palette: Palette,
    private readonly rnd: Rng,
  ) {}

  /** Starts the score at `at` on the context's clock. */
  begin(at: number): void {
    this.time = at;
    this.beat = 0;
    this.progression = -1;
    this.chordNumber = 0;
  }

  /** Picks the score up again at `at` after a pause, without playing the notes it missed. */
  resume(at: number): void {
    if (this.time < at) this.time = at;
  }

  private get beatSeconds(): number {
    return 60 / this.palette.music.bpm;
  }

  /** Schedules every note that starts before `until` (on the context's clock). */
  advance(until: number): void {
    // After a stall the notes that should have played are skipped, not played all at once;
    // the bar count goes on, so the chords stay on their grid.
    const now = this.ctx.currentTime + 0.05;
    while (this.time < now) {
      this.time += this.beatSeconds / 2;
      this.beat++;
    }
    while (this.time < until) {
      this.play(this.time);
      this.time += this.beatSeconds / 2;
      this.beat++;
    }
  }

  private chance(probability: number): boolean {
    return this.rnd() < probability;
  }

  /** One eighth note of the score. */
  private play(at: number): void {
    const eighth = this.beat % (BEATS_PER_CHORD * 2);
    if (eighth === 0) this.changeChord(at);
    const chord = this.chord;
    if (!chord) return;
    const { intensity, grandeur } = this.mood;
    const { ctx, palette: p, rnd } = this;
    const out = this.mix.music;
    const tonic = p.tonic;
    const beatSeconds = this.beatSeconds;

    // The section comes in with the empire, and on the half bar when the fighting is hot.
    if ((eighth === 0 && grandeur > 0.4) || (eighth === 8 && intensity > 0.6)) {
      const seconds = (eighth === 0 ? BEATS_PER_CHORD : BEATS_PER_CHORD / 2) * beatSeconds;
      const level = 0.35 + 0.45 * Math.max(grandeur - 0.3, intensity - 0.5);
      for (const tone of [0, chord.tones[2] ?? 7]) {
        p.swell(
          ctx,
          out,
          at,
          hz(fold(tonic + chord.root + tone, tonic - 5) + 12),
          seconds,
          level,
          rnd,
        );
      }
    }

    // A phrase of the melody every half bar, rarer as the fighting grows.
    if (eighth % 8 === 0 && this.chance(0.8 - 0.45 * intensity)) this.phrase(at);

    // Sparkles on top, thinning out as the drums come in.
    if (this.chance(0.1 + 0.2 * (1 - intensity)) && eighth % 8 !== 0) {
      const tones = chord.tones;
      const tone = tones[Math.floor(rnd() * tones.length)] ?? 0;
      const midi = fold(tonic + chord.root + tone, tonic + 12) + (this.chance(0.3) ? 12 : 0);
      p.accent(ctx, out, at + (rnd() - 0.5) * 0.03, hz(midi), 0.3 + 0.2 * rnd(), rnd);
    }

    // Drums: the pulse from a rising mood, the offbeats from a hot one.
    const low = hz(tonic - 24);
    if (intensity > 0.3 && eighth % 8 === 0) {
      drum(ctx, out, at, low, 0.25 + 0.45 * intensity, rnd, 0.45);
    }
    if (intensity > 0.55 && eighth % 8 === 4) {
      drum(ctx, out, at, low * 1.12, 0.2 + 0.3 * intensity, rnd, 0.3);
    }
    if (intensity > 0.75 && eighth % 4 === 3 && this.chance(0.7)) {
      p.tick(ctx, out, at, hz(tonic + 12 + (this.chance(0.5) ? 7 : 0)), 0.3 + 0.3 * intensity, rnd);
    }
  }

  private changeChord(at: number): void {
    const { ctx, palette: p, rnd } = this;
    const progressions = p.music.progressions;
    if (this.chordNumber % 4 === 0) {
      let next = Math.floor(rnd() * progressions.length);
      if (progressions.length > 1 && next === this.progression)
        next = (next + 1) % progressions.length;
      this.progression = next;
    }
    const chord = progressions[this.progression]?.[this.chordNumber % 4];
    this.chordNumber++;
    if (!chord) return;
    this.chord = chord;
    const seconds = BEATS_PER_CHORD * this.beatSeconds;
    const tonic = p.tonic;
    // Bass under, then the chord above, spread a little.
    p.chord(ctx, this.mix.music, at, hz(fold(tonic + chord.root, tonic - 24)), seconds, 0.9, rnd);
    chord.tones.forEach((tone, i) => {
      const midi = fold(tonic + chord.root + tone, tonic - 7);
      p.chord(ctx, this.mix.music, at + i * 0.04, hz(midi), seconds, 0.55, rnd);
    });
  }

  /** A short melody that walks the scale and comes to rest on a note of the chord. */
  private phrase(at: number): void {
    const { ctx, palette: p, rnd } = this;
    const chord = this.chord;
    if (!chord) return;
    const size = p.scale.length;
    const rhythm = RHYTHMS[Math.floor(rnd() * RHYTHMS.length)] ?? [2, 2];
    const eighth = this.beatSeconds / 2;
    let time = at;
    // Steps of the scale that lie on the chord, for the notes that land.
    const rootStep = p.scale.findIndex((semis) => semis === chord.root % 12);
    const anchors = chord.tones
      .map((tone) => p.scale.findIndex((semis) => semis === (chord.root + tone) % 12))
      .filter((step) => step >= 0);
    if (rootStep >= 0) anchors.push(rootStep);
    rhythm.forEach((length, i) => {
      const seconds = Math.abs(length) * eighth;
      if (length > 0) {
        const last = i === rhythm.length - 1;
        if (last && anchors.length > 0) {
          // Come to rest on the nearest note of the chord.
          const options = anchors.flatMap((step) => [step + size, step + 2 * size]);
          this.walker = options.reduce(
            (best, step) =>
              Math.abs(step - this.walker) < Math.abs(best - this.walker) ? step : best,
            options[0] ?? this.walker,
          );
        } else {
          const move = Math.floor(rnd() * 5) - 2;
          this.walker = Math.min(2 * size + 2, Math.max(size - 1, this.walker + move));
        }
        p.lead(ctx, this.mix.music, time, hz(degree(p, this.walker)), 0.38 + 0.2 * rnd(), rnd);
      }
      time += seconds;
    });
  }
}
