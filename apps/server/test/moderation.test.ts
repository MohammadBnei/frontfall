import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Moderation, validTarget } from "../src/moderation.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-01T12:00:00Z");
const report = { game: "abcdefgh", reason: "abuse" as const, player: 2, name: "Troll" };

describe("Moderation (R-MODE-06)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frontfall-moderation-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names addresses by a reference that never shows the address", () => {
    const moderation = new Moderation(undefined, T0);
    const ref = moderation.ref("203.0.113.7");
    expect(ref).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(ref).not.toContain("203");
    expect(moderation.ref("::ffff:203.0.113.7")).toBe(ref);
    expect(moderation.ref("203.0.113.8")).not.toBe(ref);
    expect(validTarget(ref)).toBe(true);
    expect(validTarget("203.0.113.7")).toBe(true);
    expect(validTarget("2001:db8::1")).toBe(true);
    expect(validTarget("not an address")).toBe(false);
  });

  it("keeps the same references across restarts with a data directory", () => {
    const first = new Moderation(dir, T0).ref("203.0.113.7");
    expect(new Moderation(dir, T0).ref("203.0.113.7")).toBe(first);
    expect(statSync(join(dir, "moderation", "key")).mode & 0o777).toBe(0o600);
  });

  it("records a report once per reporter, game and player, within a rate", () => {
    const moderation = new Moderation(dir, T0, { perSecond: 1 / 60, burst: 2 });
    expect(moderation.report(report, "198.51.100.1", "203.0.113.7", T0)).toBe(true);
    expect(moderation.report(report, "198.51.100.1", "203.0.113.7", T0)).toBe(true);
    expect(moderation.report({ ...report, player: 3 }, "198.51.100.1", undefined, T0)).toBe(true);
    expect(moderation.report({ ...report, player: 4 }, "198.51.100.1", undefined, T0)).toBe(false);
    expect(moderation.report(report, "198.51.100.2", "203.0.113.7", T0)).toBe(true);

    const { reports, targets } = moderation.read(T0);
    expect(reports).toHaveLength(3);
    expect(reports[2]).toMatchObject({ ...report, at: "2026-11-01T12:00:00.000Z" });
    expect(reports[1]?.target).toBeNull();
    expect(targets).toEqual([
      {
        target: moderation.ref("203.0.113.7"),
        reports: 2,
        reporters: 2,
        last: "2026-11-01T12:00:00.000Z",
        names: ["Troll"],
        reasons: { abuse: 2 },
        banned: false,
      },
    ]);
    moderation.flush();
    const file = readFileSync(join(dir, "moderation", "reports.json"), "utf8");
    expect(file).not.toContain("198.51.100");
    expect(file).not.toContain("203.0.113");
    // Kept across a restart, and forgotten after 30 days.
    expect(new Moderation(dir, T0 + DAY).read(T0 + DAY).reports).toHaveLength(3);
    expect(new Moderation(dir, T0 + 31 * DAY).read(T0 + 31 * DAY).reports).toHaveLength(0);
  });

  it("counts one address once a day against one player, and keeps 20 reports about a player", () => {
    const moderation = new Moderation(undefined, T0, { perSecond: 1, burst: 100 });
    moderation.report(report, "198.51.100.1", "203.0.113.7", T0);
    // The same player met again in another game, the same day.
    moderation.report({ ...report, game: "ijklmnop" }, "198.51.100.1", "203.0.113.7", T0 + 1000);
    expect(moderation.read(T0 + 1000).reports).toHaveLength(1);
    moderation.report({ ...report, game: "ijklmnop" }, "198.51.100.1", "203.0.113.7", T0 + DAY);
    expect(moderation.read(T0 + DAY).reports).toHaveLength(2);

    for (let i = 0; i < 30; i++) {
      moderation.report(report, `192.0.2.${String(i)}`, "198.51.100.9", T0 + DAY + i);
    }
    const { targets } = moderation.read(T0 + DAY + 30);
    expect(targets.find((t) => t.target === moderation.ref("198.51.100.9"))?.reports).toBe(20);
  });

  it("bans an address or a reference, for a while or for good", () => {
    const moderation = new Moderation(dir, T0);
    moderation.ban("203.0.113.7", 1, "insults", T0);
    moderation.ban(moderation.ref("198.51.100.1"), undefined, undefined, T0);
    expect(moderation.banned("::ffff:203.0.113.7", T0)).toMatchObject({ note: "insults" });
    expect(moderation.banned("203.0.113.7", T0 + 2 * DAY)).toBeUndefined();
    expect(moderation.banned("198.51.100.1", T0 + 365 * DAY)).toMatchObject({ until: null });
    expect(moderation.banned("198.51.100.2", T0)).toBeUndefined();

    const restarted = new Moderation(dir, T0);
    restarted.reload();
    expect(restarted.list(T0)).toHaveLength(2);
    expect(restarted.unban("203.0.113.7", T0)).toBe(true);
    expect(restarted.unban("203.0.113.7", T0)).toBe(false);
    expect(restarted.banned("203.0.113.7", T0)).toBeUndefined();
  });

  it("bans an IPv6 address with its whole /64, as players are counted", () => {
    const moderation = new Moderation(dir, T0);
    expect(validTarget("2001:db8:0:1::/64")).toBe(true);
    expect(validTarget("2001:db8::/48")).toBe(false);
    expect(moderation.ban("2001:db8:0:1::5", 1, undefined, T0).target).toBe("2001:db8:0:1::/64");
    expect(moderation.banned("2001:db8:0:1::/64", T0)).toBeDefined();
    expect(moderation.unban("2001:DB8:0:1:ffff::1", T0)).toBe(true);
  });

  it("reads a ban list written by hand, and refuses one that does not read", () => {
    const moderation = new Moderation(dir, T0);
    const file = join(dir, "moderation", "bans.json");
    writeFileSync(
      file,
      JSON.stringify({
        bans: [{ target: "203.0.113.7", until: "2026-12-01" }, { target: "2001:db8::1" }],
      }),
    );
    moderation.reload();
    expect(moderation.list(T0).map((ban) => [ban.target, ban.until])).toEqual([
      ["203.0.113.7", "2026-12-01T00:00:00.000Z"],
      ["2001:db8:0:0::/64", null],
    ]);
    writeFileSync(file, JSON.stringify({ bans: [{ target: "nobody" }] }));
    expect(() => {
      moderation.reload();
    }).toThrow("entry 1");
    // The list stays as it was.
    expect(moderation.list(T0)).toHaveLength(2);
  });
});
