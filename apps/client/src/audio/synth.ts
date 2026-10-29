import type { Cue } from "./cues.ts";
import { placed, type Mix, type Place } from "./mix.ts";
import { degree, type Palette } from "./palettes.ts";
import { boom, drum, hz, noiseHit, rush, type Rng } from "./voices.ts";

/** Melodies of the effects, as steps of the scale counted from the tonic (a negative step is below it). */
const MOTIFS: Partial<Record<Cue, readonly (readonly number[])[]>> = {
  conquest: [
    [0, 2],
    [2, 4],
    [0, 3],
    [1, 4],
    [0, 2, 4],
    [3, 1, 3],
  ],
  grand: [
    [0, 2, 4, 7],
    [0, 3, 5, 7],
    [2, 4, 7, 9],
    [0, 2, 4, 5],
  ],
  city: [
    [0, 2, 4],
    [0, 3, 5],
    [1, 3, 5],
    [0, 2, 5],
  ],
  request: [
    [2, 5],
    [1, 4],
    [3, 6],
  ],
  alert: [
    [4, 0],
    [5, 1],
    [3, 0],
  ],
  victory: [
    [0, 2, 4, 7, 9],
    [0, 2, 4, 5, 7],
    [0, 3, 4, 7, 9],
  ],
  defeat: [
    [4, 2, 0, -2],
    [3, 2, 0, -3],
    [4, 1, 0, -2],
  ],
};

/**
 * Plays the effects of a game with one palette. Each cue has several
 * variants, and the same variant never plays twice in a row, so a long game
 * does not turn into a loop of the same few clips.
 */
export class CuePlayer {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly mix: Mix,
    private readonly palette: Palette,
    private readonly rnd: Rng,
  ) {}

  /** A number in [0, count) that is not the one given last time for `key`, if there is a choice. */
  private vary(key: string, count: number): number {
    const last = this.last.get(key);
    let pick = Math.floor(this.rnd() * count);
    if (count > 1 && pick === last) {
      pick = (pick + 1 + Math.floor(this.rnd() * (count - 1))) % count;
    }
    this.last.set(key, pick);
    return pick;
  }

  /** A velocity close to 1, a little different each time. */
  private velocity(): number {
    return 0.78 + this.rnd() * 0.22;
  }

  /** A moment a few milliseconds off, so that two notes are not on a grid. */
  private jitter(): number {
    return (this.rnd() - 0.5) * 0.016;
  }

  private note(step: number): number {
    return hz(degree(this.palette, step));
  }

  /** Plays `cue` from `at` (on the context's clock) as heard from `place`. */
  play(cue: Cue, at: number, place: Place): void {
    const { ctx, palette: p, rnd } = this;
    const out = placed(ctx, this.mix, place);
    const size = p.scale.length;
    const motifs = MOTIFS[cue];
    const motif = motifs?.[this.vary(cue, motifs.length)];
    const lead = (step: number, when: number, velocity = 1, octave = 1): void => {
      p.lead(ctx, out, when, this.note(step + octave * size), velocity * this.velocity(), rnd);
    };
    const accent = (step: number, when: number, velocity = 1, octave = 2): void => {
      p.accent(ctx, out, when, this.note(step + octave * size), velocity * this.velocity(), rnd);
    };
    const tick = (step: number, when: number, velocity = 1): void => {
      p.tick(ctx, out, when, this.note(step + size * 2), velocity * this.velocity(), rnd);
    };
    const chord = (
      steps: readonly number[],
      seconds: number,
      velocity: number,
      octave = 0,
    ): void => {
      for (const step of steps) {
        p.chord(ctx, out, at, this.note(step + octave * size), seconds, velocity, rnd);
      }
    };
    const swell = (
      steps: readonly number[],
      seconds: number,
      velocity: number,
      octave = 0,
    ): void => {
      for (const step of steps) {
        p.swell(ctx, out, at, this.note(step + octave * size), seconds, velocity, rnd);
      }
    };

    switch (cue) {
      case "start": {
        swell([0, 2, 4], 2.2, 0.9);
        drum(ctx, out, at, hz(p.tonic - 24), 0.8, rnd, 0.5);
        [0, 2, 4].forEach((step, i) => {
          accent(step, at + 0.5 + i * 0.22, 0.8, 1);
        });
        break;
      }
      case "attack": {
        const variant = this.vary("attack.v", 3);
        rush(ctx, out, at, rnd, {
          from: 2600 - variant * 500,
          to: 500,
          seconds: 0.2,
          level: 0.2,
          q: 1.8,
          swell: 0.03,
        });
        drum(ctx, out, at, hz(p.tonic - 26 + variant * 2), 0.7 * this.velocity(), rnd, 0.22);
        tick(variant, at + 0.04 + this.jitter(), 0.6);
        tick(variant + 2, at + 0.12 + this.jitter(), 0.5);
        break;
      }
      case "conquest":
      case "grand": {
        const steps = motif ?? [0, 2];
        const gap = cue === "grand" ? 0.075 : 0.09;
        steps.forEach((step, i) => {
          lead(step, at + i * gap + this.jitter(), cue === "grand" ? 0.95 : 0.8);
        });
        accent(steps[steps.length - 1] ?? 0, at + steps.length * gap, 0.5);
        if (cue === "grand") {
          chord([0, 2, 4], 0.9, 0.7, 0);
          drum(ctx, out, at, hz(p.tonic - 24), 0.6, rnd, 0.4);
        }
        break;
      }
      case "city": {
        [0, 0.11 + this.jitter(), 0.21 + this.jitter()].forEach((when, i) => {
          tick(i % 2, at + when, 0.7);
        });
        (motif ?? [0, 2, 4]).forEach((step, i) => {
          lead(step, at + 0.34 + i * 0.075, 0.85);
        });
        accent(4, at + 0.59, 0.4);
        break;
      }
      case "fort": {
        drum(ctx, out, at, hz(p.tonic - 17), 0.8, rnd, 0.3);
        noiseHit(ctx, out, at, rnd, {
          type: "lowpass",
          from: 1400,
          to: 200,
          level: 0.3,
          tau: 0.08,
        });
        tick(-2, at + 0.12, 0.8);
        tick(-1, at + 0.22 + this.jitter(), 0.9);
        lead(0, at + 0.34, 0.8, 0);
        lead(2, at + 0.43, 0.7, 0);
        break;
      }
      case "port": {
        rush(ctx, out, at, rnd, {
          from: 300,
          to: 1300,
          seconds: 0.7,
          level: 0.12,
          q: 0.7,
          swell: 0.25,
        });
        accent(2, at + 0.12, 0.8, 1);
        accent(4, at + 0.38, 0.7, 1);
        swell([-3], 1.1, 0.8, 0);
        break;
      }
      case "palace": {
        swell([0, 2, 4], 2.4, 1);
        swell([0], 2.4, 0.8, -1);
        drum(ctx, out, at, hz(p.tonic - 24), 0.8, rnd, 0.5);
        [0, 2, 4, 7, 9].forEach((step, i) => {
          accent(step, at + 0.2 + i * 0.1, 0.7, 1);
        });
        break;
      }
      case "silo": {
        boom(ctx, out, at, hz(p.tonic - 24), 0.6, rnd);
        accent(-3, at + 0.05, 0.9, 1);
        rush(ctx, out, at + 0.1, rnd, {
          from: 160,
          to: 800,
          seconds: 0.7,
          level: 0.1,
          q: 2,
          swell: 0.4,
        });
        lead(0, at + 0.55, 0.7, 0);
        lead(-2, at + 0.65, 0.7, 0);
        break;
      }
      case "defense": {
        accent(4, at, 0.9, 2);
        accent(2, at + 0.11, 0.8, 2);
        rush(ctx, out, at + 0.2, rnd, {
          from: 5000,
          to: 1800,
          seconds: 0.25,
          level: 0.06,
          q: 3,
          swell: 0.02,
        });
        break;
      }
      case "missile": {
        const rise = 0.95;
        rush(ctx, out, at, rnd, {
          from: 260,
          to: 3200,
          seconds: rise,
          level: 0.3,
          q: 1.2,
          swell: 0.5,
        });
        rush(ctx, out, at, rnd, {
          from: 90,
          to: 520,
          seconds: rise,
          level: 0.25,
          q: 0.7,
          swell: 0.4,
        });
        drum(ctx, out, at, hz(p.tonic - 24), 0.7, rnd, 0.35);
        tick(0, at, 0.5);
        break;
      }
      case "impact": {
        boom(ctx, out, at, hz(p.tonic - 24 - this.vary("impact.v", 3) * 2), 0.95, rnd);
        rush(ctx, out, at, rnd, {
          from: 1800,
          to: 140,
          seconds: 0.9,
          level: 0.28,
          q: 0.6,
          swell: 0.01,
        });
        break;
      }
      case "alliance": {
        swell([0, 2, 4], 1.8, 0.9, 0);
        [2, 4, 7].forEach((step, i) => {
          accent(step, at + 0.1 + i * 0.16, 0.8, 1);
        });
        break;
      }
      case "request": {
        const steps = motif ?? [2, 5];
        steps.forEach((step, i) => {
          lead(step, at + i * 0.18, 0.8);
        });
        steps.forEach((step, i) => {
          lead(step, at + 0.72 + i * 0.18, 0.45);
        });
        break;
      }
      case "betrayal": {
        drum(ctx, out, at, hz(p.tonic - 24), 0.95, rnd, 0.5);
        for (const semis of [-12, -11]) {
          p.swell(ctx, out, at, hz(p.tonic + semis), 1.5, 0.9, rnd);
        }
        rush(ctx, out, at, rnd, {
          from: 1500,
          to: 120,
          seconds: 0.7,
          level: 0.2,
          q: 0.9,
          swell: 0.02,
        });
        break;
      }
      case "alert": {
        (motif ?? [4, 0]).forEach((step, i) => {
          lead(step, at + i * 0.15, 0.9);
        });
        drum(ctx, out, at, hz(p.tonic - 22), 0.55, rnd, 0.22);
        break;
      }
      case "victory": {
        swell([0, 2, 4, 7], 2.8, 1, 0);
        swell([0], 2.8, 0.9, -1);
        drum(ctx, out, at, hz(p.tonic - 24), 0.9, rnd, 0.6);
        (motif ?? [0, 2, 4, 7]).forEach((step, i) => {
          lead(step, at + 0.1 + i * 0.13, 0.95);
          accent(step, at + 0.11 + i * 0.13, 0.35, 2);
        });
        break;
      }
      case "defeat": {
        for (const semis of [-12, -9, -5]) {
          p.swell(ctx, out, at, hz(p.tonic + semis), 3.2, 0.9, rnd);
        }
        boom(ctx, out, at, hz(p.tonic - 26), 0.7, rnd);
        (motif ?? [4, 2, 0, -2]).forEach((step, i) => {
          lead(step, at + 0.15 + i * 0.3, 0.7, 0);
        });
        break;
      }
    }
  }
}
