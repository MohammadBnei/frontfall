import * as z from "zod/mini";

/** Largest tile index a message may carry: maps stay well below 2^31 tiles. */
export const MAX_TILE = 2 ** 31 - 1;

const tile = z.int().check(z.minimum(0), z.maximum(MAX_TILE));
const amount = z.int().check(z.positive(), z.maximum(Number.MAX_SAFE_INTEGER));
const share = z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER));
/** Code of a structure kind (the engine's StructureKind); the engine refuses codes it does not know. */
const structure = z.int().check(z.minimum(0), z.maximum(255));

/**
 * Every kind of order, in wire order: the position of a kind in this list is
 * its code in binary frames, and the field list gives the order in which its
 * values are written. Append new kinds at the end and never reorder.
 */
export const ORDER_KINDS = [
  { type: "spawn", fields: ["tile"] },
  { type: "attack", fields: ["target", "troops"] },
  { type: "retreat", fields: ["attack"] },
  { type: "embark", fields: ["target", "troops"] },
  { type: "build", fields: ["structure", "tile"] },
  { type: "demolish", fields: ["tile"] },
  { type: "ally", fields: ["target"] },
  { type: "betray", fields: ["target"] },
  { type: "embargo", fields: ["target", "on"] },
  { type: "warship", fields: ["port"] },
  { type: "patrol", fields: ["ship", "tile"] },
  { type: "missile", fields: ["target", "size"] },
  { type: "gift", fields: ["target", "troops", "gold"] },
  { type: "quick", fields: ["target", "phrase"] },
  { type: "work", fields: ["share"] },
  { type: "tribute", fields: ["target"] },
  { type: "doctrine", fields: ["pick"] },
] as const;

/** Player number inside one game, from 1. Zero is the neutral owner of the engine. */
export const PlayerNumber = z.int().check(z.minimum(1), z.maximum(0xffff));

/** An order from a player. The server relays orders; every client executes them. */
export const Order = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("spawn"), tile }),
  z.strictObject({ type: z.literal("attack"), target: tile, troops: amount }),
  z.strictObject({ type: z.literal("retreat"), attack: amount }),
  z.strictObject({ type: z.literal("embark"), target: tile, troops: amount }),
  z.strictObject({ type: z.literal("build"), structure, tile }),
  z.strictObject({ type: z.literal("demolish"), tile }),
  z.strictObject({ type: z.literal("ally"), target: PlayerNumber }),
  z.strictObject({ type: z.literal("betray"), target: PlayerNumber }),
  /** `on`: 1 starts an embargo, 0 lifts it. */
  z.strictObject({
    type: z.literal("embargo"),
    target: PlayerNumber,
    on: z.int().check(z.minimum(0), z.maximum(1)),
  }),
  z.strictObject({ type: z.literal("warship"), port: tile }),
  z.strictObject({ type: z.literal("patrol"), ship: amount, tile }),
  /** `size`: the engine's MissileSize code, which it checks. */
  z.strictObject({
    type: z.literal("missile"),
    target: tile,
    size: z.int().check(z.minimum(0), z.maximum(255)),
  }),
  /** Troops and gold sent to another player; the engine refuses a gift of neither. */
  z.strictObject({ type: z.literal("gift"), target: PlayerNumber, troops: share, gold: share }),
  /** `phrase`: the engine's preset quick message, which it checks. */
  z.strictObject({
    type: z.literal("quick"),
    target: PlayerNumber,
    phrase: z.int().check(z.minimum(0), z.maximum(255)),
  }),
  /** `share`: % of the troops at home put to work, which the engine checks against B-WORK-MAX. */
  z.strictObject({ type: z.literal("work"), share: z.int().check(z.minimum(0), z.maximum(100)) }),
  /** Pays the price of a tribute to `target`, which the engine works out, for a truce. */
  z.strictObject({ type: z.literal("tribute"), target: PlayerNumber }),
  /** `pick`: the engine's Doctrine code, which it checks. */
  z.strictObject({
    type: z.literal("doctrine"),
    pick: z.int().check(z.minimum(0), z.maximum(255)),
  }),
]);
export type Order = z.infer<typeof Order>;

export type OrderType = Order["type"];

/** Every order accepted during one tick, in the order the server accepted them. */
export interface Turn {
  tick: number;
  orders: { player: number; order: Order }[];
}
