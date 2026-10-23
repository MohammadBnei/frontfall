import type { Order as EngineOrder, Turn as EngineTurn } from "@frontfall/engine";
import { describe, expectTypeOf, it } from "vitest";
import type { Order, Turn } from "../src/orders.ts";

describe("protocol and engine", () => {
  it("carry the same orders, field for field", () => {
    expectTypeOf<Order>().toEqualTypeOf<EngineOrder>();
  });

  it("carry turns the engine can step through", () => {
    expectTypeOf<Turn>().toExtend<EngineTurn>();
  });
});
