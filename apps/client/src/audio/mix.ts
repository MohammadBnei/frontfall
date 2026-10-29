import { roomImpulse } from "./voices.ts";

/**
 * Where a sound is heard from: how far to the side, how loud, how muffled and
 * how much of the room it carries. A sound close to the view is dry and bright;
 * one far from it is quiet, dull and washed in the room.
 */
export interface Place {
  /** -1 (left) to 1 (right). */
  pan: number;
  /** 0 to 1. */
  gain: number;
  /** Cut-off of the low-pass filter, in hertz. */
  cutoff: number;
  /** Share sent to the room, 0 to 1. */
  wet: number;
}

/** The place of a sound heard at the centre of the screen. */
export const HERE: Place = { pan: 0, gain: 1, cutoff: 18000, wet: 0.22 };

/** The graph every sound goes through: two buses, one room and a limiter. */
export interface Mix {
  /** Sound effects come in here, through `placed`. */
  readonly sfx: GainNode;
  /** The music comes in here. */
  readonly music: GainNode;
  /** Whatever is sent to this node is heard with the room around it. */
  readonly send: GainNode;
  /** Moves the buses to new levels; the music takes `fade` seconds to settle, the effects a moment. */
  setLevels(effects: number, music: number, at: number, fade?: number): void;
}

export function createMix(
  ctx: BaseAudioContext,
  room: { seconds: number; dark: number; wet: number },
): Mix {
  const sfx = ctx.createGain();
  const music = ctx.createGain();
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16;
  limiter.knee.value = 14;
  limiter.ratio.value = 3.5;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.22;
  master.connect(limiter).connect(ctx.destination);
  sfx.connect(master);
  music.connect(master);

  const convolver = ctx.createConvolver();
  convolver.buffer = roomImpulse(ctx, room.seconds, room.dark);
  const send = ctx.createGain();
  const back = ctx.createGain();
  back.gain.value = room.wet;
  send.connect(convolver).connect(back).connect(master);
  // The music always has some room around it.
  const musicSend = ctx.createGain();
  musicSend.gain.value = 0.45;
  music.connect(musicSend).connect(send);

  return {
    sfx,
    music,
    send,
    setLevels(effects, level, at, fade = 0.4) {
      sfx.gain.setTargetAtTime(effects, at, 0.05);
      music.gain.setTargetAtTime(level, at, fade);
    },
  };
}

/** The input of a sound's own chain, which ends in the buses of `mix`. */
export function placed(ctx: BaseAudioContext, mix: Mix, place: Place): AudioNode {
  const input = ctx.createGain();
  input.gain.value = place.gain;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.5;
  filter.frequency.value = place.cutoff;
  const panner = ctx.createStereoPanner();
  panner.pan.value = place.pan;
  input.connect(filter).connect(panner);
  panner.connect(mix.sfx);
  const wet = ctx.createGain();
  wet.gain.value = place.wet;
  panner.connect(wet).connect(mix.send);
  return input;
}
