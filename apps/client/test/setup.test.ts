import { describe, expect, it } from "vitest";
import { GENERATED_MAPS as maps } from "../src/game/maps.ts";
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
    const setup = initialSetup("?map=pangaea&bots=8&difficulty=hard", undefined, maps);
    expect(setup).toMatchObject({ map: "pangaea", bots: 8, difficulty: "hard" });
    expect(initialSetup(setupQuery(setup), undefined, maps)).toEqual(setup);
  });

  it("shares a team game in its link, and a free-for-all as before (R-MODE-02)", () => {
    const setup = initialSetup("?map=pangaea&teams=3", undefined, maps);
    expect(setup.teams).toBe(3);
    expect(setupQuery(setup)).toContain("teams=3");
    expect(setupQuery({ ...setup, teams: 0 })).not.toContain("teams");
    expect(initialSetup("?teams=5", undefined, maps).teams ?? 0).toBe(0);
  });

  it("ignores values it does not know", () => {
    const base = defaultSetup(maps);
    expect(
      sanitizeSetup({ map: "atlantis", bots: "lots", difficulty: "insane" }, base, maps),
    ).toEqual(base);
    expect(sanitizeSetup({ bots: "999" }, base, maps).bots).toBe(25);
    expect(sanitizeSetup({ bots: "-3" }, base, maps).bots).toBe(0);
  });

  it("remembers the last setup, and lets the link override it", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    saveSetup({ ...defaultSetup(maps), playerName: "Ada", bots: 4 }, storage);
    expect(initialSetup("", storage, maps)).toMatchObject({ playerName: "Ada", bots: 4 });
    expect(initialSetup("?bots=6", storage, maps)).toMatchObject({ playerName: "Ada", bots: 6 });
  });

  it("works with storage disabled", () => {
    expect(initialSetup("?bots=3", throwing, maps).bots).toBe(3);
    expect(() => {
      saveSetup(defaultSetup(maps), throwing);
    }).not.toThrow();
  });

  it("cleans player names", () => {
    expect(cleanName("  Ada\u0000 Lovelace the Countess of Code ")).toBe("Ada Lovelace the Cou");
  });
});
