import { z } from "zod";
import { ORDER_KINDS, Order, PlayerNumber, type Turn } from "./orders.ts";

/** First byte of every binary frame. */
export const FrameKind = {
  /** Server to client: consecutive turns. */
  turns: 1,
  /** Client to server: one order. */
  order: 2,
} as const;

export class DecodeError extends Error {}

/** Unsigned LEB128 writer for integers up to Number.MAX_SAFE_INTEGER. */
export class ByteWriter {
  private bytes = new Uint8Array(64);
  private length = 0;

  byte(value: number): this {
    this.reserve(1);
    this.bytes[this.length++] = value;
    return this;
  }

  varint(value: number): this {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`cannot encode ${String(value)} as an unsigned integer`);
    }
    this.reserve(8);
    // Division instead of bit shifts: shifts would truncate values above 2^31.
    while (value >= 0x80) {
      this.bytes[this.length++] = (value % 0x80) | 0x80;
      value = Math.floor(value / 0x80);
    }
    this.bytes[this.length++] = value;
    return this;
  }

  raw(chunk: Uint8Array): this {
    this.reserve(chunk.length);
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;
    return this;
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
}

/** Reader matching ByteWriter. Rejects truncated, oversized and non-canonical values. */
export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new DecodeError("frame ends early");
    this.offset++;
    return value;
  }

  varint(): number {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 8; index++) {
      const byte = this.byte();
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        if (byte === 0 && index > 0) throw new DecodeError("integer is not minimally encoded");
        if (value > Number.MAX_SAFE_INTEGER) throw new DecodeError("integer is too large");
        return value;
      }
      scale *= 0x80;
    }
    throw new DecodeError("integer is too large");
  }

  /** A count of items that each take at least `minBytes`, checked against what is left. */
  count(minBytes: number): number {
    const count = this.varint();
    if (count * minBytes > this.remaining) throw new DecodeError("count exceeds the frame");
    return count;
  }

  end(): void {
    if (this.remaining > 0) throw new DecodeError("unexpected bytes after the frame");
  }
}

const ORDER_CODES = new Map<string, number>(ORDER_KINDS.map((kind, code) => [kind.type, code]));

export function writeOrder(writer: ByteWriter, order: Order): void {
  const code = ORDER_CODES.get(order.type);
  const kind = code === undefined ? undefined : ORDER_KINDS[code];
  if (code === undefined || !kind) throw new RangeError(`unknown order type ${order.type}`);
  writer.varint(code);
  const values = order as unknown as Record<string, number>;
  for (const field of kind.fields) writer.varint(values[field] ?? 0);
}

export function readOrder(reader: ByteReader): Order {
  const kind = ORDER_KINDS[reader.varint()];
  if (!kind) throw new DecodeError("unknown order type");
  const order: Record<string, unknown> = { type: kind.type };
  for (const field of kind.fields) order[field] = reader.varint();
  return validate(Order, order);
}

/** The orders of one tick, without the tick number. Stored as is in the turn log. */
export function encodeTurnBody(orders: Turn["orders"]): Uint8Array {
  const writer = new ByteWriter().varint(orders.length);
  for (const { player, order } of orders) {
    writer.varint(player);
    writeOrder(writer, order);
  }
  return writer.finish();
}

/** Consecutive turns starting at `from`, from bodies built by encodeTurnBody. */
export function encodeTurnsFrame(from: number, bodies: readonly Uint8Array[]): Uint8Array {
  const writer = new ByteWriter().byte(FrameKind.turns).varint(from).varint(bodies.length);
  for (const body of bodies) writer.raw(body);
  return writer.finish();
}

export function encodeOrderFrame(order: Order): Uint8Array {
  const writer = new ByteWriter().byte(FrameKind.order);
  writeOrder(writer, order);
  return writer.finish();
}

export type BinaryFrame = { kind: "turns"; turns: Turn[] } | { kind: "order"; order: Order };

/** Decodes and validates a binary frame. Throws DecodeError on any defect. */
export function decodeFrame(bytes: Uint8Array): BinaryFrame {
  const reader = new ByteReader(bytes);
  const kind = reader.byte();
  if (kind === FrameKind.order) {
    const order = readOrder(reader);
    reader.end();
    return { kind: "order", order };
  }
  if (kind === FrameKind.turns) {
    const from = reader.varint();
    // An empty turn takes one byte, an order at least three.
    const count = reader.count(1);
    const turns: Turn[] = [];
    for (let index = 0; index < count; index++) {
      const orders: Turn["orders"] = [];
      const size = reader.count(3);
      for (let item = 0; item < size; item++) {
        const player = validate(PlayerNumber, reader.varint());
        orders.push({ player, order: readOrder(reader) });
      }
      turns.push({ tick: from + index, orders });
    }
    reader.end();
    return { kind: "turns", turns };
  }
  throw new DecodeError("unknown frame kind");
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DecodeError(z.prettifyError(result.error));
  return result.data;
}
