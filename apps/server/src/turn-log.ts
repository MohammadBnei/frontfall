import { encodeTurnBody, encodeTurnsFrame, type Turn } from "@frontfall/protocol";

/**
 * Every turn of one game, encoded once and kept back to back in one buffer. A
 * player who rejoins replays the log from the tick they last ran.
 */
export class TurnLog {
  private bytes = new Uint8Array(4096);
  private used = 0;
  /** Offset of each turn in `bytes`, plus the end of the last one. */
  private offsets = new Uint32Array(1024);
  private count = 0;

  /** Number of turns logged, which is also the tick of the next turn. */
  get length(): number {
    return this.count;
  }

  get byteLength(): number {
    return this.used + this.offsets.byteLength;
  }

  /** Logs the next turn and returns its encoded body. */
  append(orders: Turn["orders"]): Uint8Array {
    const body = encodeTurnBody(orders);
    if (this.used + body.length > this.bytes.length) {
      this.bytes = grow(this.bytes, this.used + body.length);
    }
    if (this.count + 2 > this.offsets.length) this.offsets = grow(this.offsets, this.count + 2);
    this.bytes.set(body, this.used);
    this.used += body.length;
    this.offsets[++this.count] = this.used;
    return body;
  }

  /** Frames carrying every turn from `from` on, at most `perFrame` turns each. */
  *frames(from: number, perFrame = 2000): Generator<Uint8Array> {
    for (let start = from; start < this.count; start += perFrame) {
      const end = Math.min(this.count, start + perFrame);
      const bodies: Uint8Array[] = [];
      for (let tick = start; tick < end; tick++) {
        bodies.push(this.bytes.subarray(this.offsets[tick], this.offsets[tick + 1]));
      }
      yield encodeTurnsFrame(start, bodies);
    }
  }
}

function grow<T extends Uint8Array | Uint32Array>(array: T, needed: number): T {
  let size = array.length * 2;
  while (size < needed) size *= 2;
  const grown = new (array.constructor as new (length: number) => T)(size);
  grown.set(array);
  return grown;
}
