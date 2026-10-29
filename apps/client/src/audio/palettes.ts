import { kalimba, marimba, pad, strings, wood, type Held, type Voice } from "./voices.ts";

/** A chord: its root in semitones above the tonic, and the notes above that root. */
export interface Chord {
  root: number;
  tones: readonly number[];
}

const maj = [0, 4, 7, 14];
const maj7 = [0, 4, 7, 11];
const min7 = [0, 3, 7, 10];
const min9 = [0, 3, 7, 14];
const sus = [0, 2, 7, 12];

/** One sound design: the scale, the instruments and the room that a game is heard in. */
export interface Palette {
  id: string;
  /** MIDI number of the tonic, in the middle of the range. */
  tonic: number;
  /** Notes of the scale in semitones above the tonic. */
  scale: readonly number[];
  /** Plays the melodies of the effects and of the music. */
  lead: Voice;
  /** Plays the high accents. */
  accent: Voice;
  /** Plays the dry knocks. */
  tick: Voice;
  /** Holds the chords. */
  chord: Held;
  /** Swells at the big moments. */
  swell: Held;
  room: { seconds: number; dark: number; wet: number };
  music: {
    bpm: number;
    /** Progressions of four chords of eight beats each; one is chosen after another. */
    progressions: readonly (readonly Chord[])[];
  };
}

/** Wood, mallets and soft strings: a warm, hand-made map table. */
const ATLAS: Palette = {
  id: "atlas",
  tonic: 62,
  scale: [0, 2, 4, 7, 9],
  lead: marimba,
  accent: kalimba,
  tick: wood,
  chord: pad,
  swell: strings,
  room: { seconds: 1.9, dark: 0.9, wet: 0.55 },
  music: {
    bpm: 68,
    progressions: [
      [
        { root: 0, tones: maj },
        { root: 9, tones: min7 },
        { root: 5, tones: maj7 },
        { root: 7, tones: sus },
      ],
      [
        { root: 0, tones: maj7 },
        { root: 5, tones: maj },
        { root: 2, tones: min7 },
        { root: 7, tones: maj },
      ],
      [
        { root: 5, tones: maj7 },
        { root: 0, tones: maj },
        { root: 9, tones: min9 },
        { root: 7, tones: sus },
      ],
    ],
  },
};

/** The sound design the game plays with. */
export const PALETTE: Palette = ATLAS;

/** MIDI number of the `index`th note of the palette's scale, counted from the tonic; it may be negative or exceed the scale. */
export function degree(palette: Palette, index: number): number {
  const size = palette.scale.length;
  const octave = Math.floor(index / size);
  const step = palette.scale[index - octave * size] ?? 0;
  return palette.tonic + step + octave * 12;
}
