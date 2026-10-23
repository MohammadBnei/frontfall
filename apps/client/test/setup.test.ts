import { describe, expect, it } from "vitest";
import {
  cleanName,
  defaultSetup,
  initialSetup,
  sanitizeSetup,
  saveSetup,
  setupQuery,
} from "../src/ui/setup.ts";

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwing = {
  getItem(): never {
    throw new Error("SecurityError");
  },
  setItem(): never {
    throw new Error("QuotaExceededError");
  },
} as unknown as Storage;

describe("game setup", () => {
  it("starts the setup of a shared link", () => {
    const setup = initialSetup("?map=pangaea&bots=8&difficulty=hard", undefined);
    expect(setup).toMatchObject({ map: "pangaea", bots: 8, difficulty: "hard" });
    expect(initialSetup(setupQuery(setup), undefined)).toEqual(setup);
  });

  it("ignores values it does not know", () => {
    const base = defaultSetup();
    expect(sanitizeSetup({ map: "atlantis", bots: "lots", difficulty: "insane" }, base)).toEqual(
      base,
    );
    expect(sanitizeSetup({ bots: "999" }, base).bots).toBe(25);
    expect(sanitizeSetup({ bots: "0" }, base).bots).toBe(1);
  });

  it("remembers the last setup, and lets the link override it", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    saveSetup({ ...defaultSetup(), playerName: "Ada", bots: 4 }, storage);
    expect(initialSetup("", storage)).toMatchObject({ playerName: "Ada", bots: 4 });
    expect(initialSetup("?bots=6", storage)).toMatchObject({ playerName: "Ada", bots: 6 });
  });

  it("works with storage disabled", () => {
    expect(initialSetup("?bots=3", throwing).bots).toBe(3);
    expect(() => {
      saveSetup(defaultSetup(), throwing);
    }).not.toThrow();
  });

  it("cleans player names", () => {
    expect(cleanName("  Ada\u0000 Lovelace the Countess of Code ")).toBe("Ada Lovelace the Cou");
  });
});
