import { z } from "zod";

/** Largest tile index a message may carry: maps stay well below 2^31 tiles. */
export const MAX_TILE = 2 ** 31 - 1;

const tile = z.number().int().min(0).max(MAX_TILE);
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

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
] as const;

/** An order from a player. The server relays orders; every client executes them. */
export const Order = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spawn"), tile }).strict(),
  z.object({ type: z.literal("attack"), target: tile, troops: amount }).strict(),
  z.object({ type: z.literal("retreat"), attack: amount }).strict(),
  z.object({ type: z.literal("embark"), target: tile, troops: amount }).strict(),
]);
export type Order = z.infer<typeof Order>;

export type OrderType = Order["type"];

/** Player number inside one game, from 1. Zero is the neutral owner of the engine. */
export const PlayerNumber = z.number().int().min(1).max(0xffff);

/** Every order accepted during one tick, in the order the server accepted them. */
export interface Turn {
  tick: number;
  orders: { player: number; order: Order }[];
}
