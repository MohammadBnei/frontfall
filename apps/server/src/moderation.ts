import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import type { ReportReason } from "@frontfall/protocol";
import { network } from "./address.ts";
import { AddressRate } from "./rate-limit.ts";

/** Reports older than this are forgotten (R-MODE-06). */
export const REPORT_DAYS = 30;
/** Reports kept at most, the oldest dropped first. */
const MAX_REPORTS = 500;
/** Reports kept about one player, so that a campaign against one fills no more. */
const MAX_REPORTS_PER_TARGET = 20;
/** How long one address counts once against one player, whatever the game. */
const SAME_TARGET_MS = 24 * 60 * 60 * 1000;
/** Reports are written this long after the last one, off the path of the message. */
const SAVE_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One report of a player by another, as the operator reads it. */
export interface Report {
  at: string;
  game: string;
  reason: ReportReason;
  /** Reference of the reporter's address. */
  from: string;
  /** Number of the player reported in that game, and the name they played under. */
  player: number;
  name: string;
  /** Reference of the reported player's address; null when the server no longer knew it. */
  target: string | null;
}

/** One entry of the ban list: an address, or the reference of one, until a date or for good. */
export interface Ban {
  target: string;
  until: string | null;
  note?: string;
}

/** What the operator sees of the reports of one player, the most reported first. */
export interface ReportedTarget {
  target: string;
  reports: number;
  /** Different addresses that reported it: one angry player counts once. */
  reporters: number;
  last: string;
  names: string[];
  reasons: Partial<Record<ReportReason, number>>;
  banned: boolean;
}

/** A target the ban list takes: an IP address, or a reference as reports give them. */
export function validTarget(target: string): boolean {
  return (
    isIP(target) !== 0 ||
    /^[A-Za-z0-9_-]{16}$/.test(target) ||
    (target.endsWith("::/64") && isIP(target.slice(0, -3)) === 6)
  );
}

/** A ban target as connections are matched against it: an IPv6 address bans its /64. */
function banTarget(target: string): string {
  if (target.endsWith("/64")) return network(target.slice(0, -3));
  return isIP(target) ? network(plain(target)) : target;
}

/** The usual `::ffff:` form of an IPv4 address seen on an IPv6 socket, as plain IPv4. */
function plain(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function writePrivate(file: string, text: string): void {
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

function readIfAny(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Reports of players and the operator's ban list (R-MODE-06). An address is
 * never written down: reports name it by a reference, a keyed hash that stays
 * the same across restarts when the server has a data directory, and that the
 * operator can ban without ever seeing the address.
 */
export class Moderation {
  private readonly key: Buffer;
  private reports: Report[] = [];
  private bans: Ban[] = [];
  private readonly rate: AddressRate;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param directory where the key, the reports and the ban list are kept;
   * undefined keeps them in memory, with references that change at each start.
   * The ban list is read by `reload`, which says when the file does not read.
   */
  constructor(
    private readonly directory: string | undefined,
    now: number,
    rate = { perSecond: 1 / 120, burst: 5 },
  ) {
    this.rate = new AddressRate(rate.perSecond, rate.burst, now);
    this.key = this.loadKey();
    if (directory !== undefined) {
      const text = readIfAny(this.file("reports.json"));
      if (text !== undefined) this.reports = parseReports(text);
    }
  }

  /** The reference of an address, as reports give it and the ban list takes it. */
  ref(address: string): string {
    return createHmac("sha256", this.key).update(plain(address)).digest("base64url").slice(0, 16);
  }

  /** The ban that turns this address away at `now`, if any. */
  banned(address: string, now: number): Ban | undefined {
    const ip = plain(address);
    const ref = this.ref(address);
    return this.bans.find(
      (ban) =>
        (ban.target === ip || ban.target === ref) &&
        (ban.until === null || Date.parse(ban.until) > now),
    );
  }

  /**
   * Records a report, once per reporter, game and player, and once a day
   * per reporter and reported address. False when the reporter's address
   * has sent too many lately.
   */
  report(
    report: Omit<Report, "at" | "from" | "target">,
    from: string,
    target: string | undefined,
    now: number,
  ): boolean {
    const fromRef = this.ref(from);
    const targetRef = target === undefined ? null : this.ref(target);
    const twice = this.reports.some(
      (r) =>
        r.from === fromRef &&
        ((r.game === report.game && r.player === report.player) ||
          (targetRef !== null &&
            r.target === targetRef &&
            now - Date.parse(r.at) < SAME_TARGET_MS)),
    );
    if (twice) return true;
    if (!this.rate.take(from, now)) return false;
    this.reports.push({
      at: new Date(now).toISOString(),
      ...report,
      from: fromRef,
      target: targetRef,
    });
    if (targetRef !== null) {
      const about = this.reports.filter((r) => r.target === targetRef);
      if (about.length > MAX_REPORTS_PER_TARGET) {
        const oldest = about[0];
        this.reports = this.reports.filter((r) => r !== oldest);
      }
    }
    this.prune(now);
    this.saveReportsSoon();
    return true;
  }

  /** Reports of the last `days`, newest first, and the players they name, the most reported first. */
  read(now: number, days = REPORT_DAYS): { reports: Report[]; targets: ReportedTarget[] } {
    this.prune(now);
    const since = now - days * DAY_MS;
    const reports = this.reports.filter((r) => Date.parse(r.at) >= since).reverse();
    const banned = new Set(this.list(now).map((ban) => ban.target));
    const byTarget = new Map<string, ReportedTarget>();
    const reporters = new Map<string, Set<string>>();
    for (const r of reports) {
      if (r.target === null) continue;
      let entry = byTarget.get(r.target);
      if (!entry) {
        entry = {
          target: r.target,
          reports: 0,
          reporters: 0,
          last: r.at,
          names: [],
          reasons: {},
          banned: banned.has(r.target),
        };
        byTarget.set(r.target, entry);
      }
      const from = reporters.get(r.target) ?? new Set();
      reporters.set(r.target, from.add(r.from));
      entry.reports++;
      entry.reporters = from.size;
      entry.reasons[r.reason] = (entry.reasons[r.reason] ?? 0) + 1;
      if (!entry.names.includes(r.name)) entry.names.push(r.name);
    }
    const targets = [...byTarget.values()].sort(
      (a, b) => b.reporters - a.reporters || b.reports - a.reports,
    );
    return { reports, targets };
  }

  /** The ban list, expired entries left out. */
  list(now: number): Ban[] {
    return this.bans.filter((ban) => ban.until === null || Date.parse(ban.until) > now);
  }

  /** Bans `target` for `days`, or for good when `days` is undefined; replaces an earlier ban of it. */
  ban(given: string, days: number | undefined, note: string | undefined, now: number): Ban {
    const target = banTarget(given);
    const ban: Ban = {
      target,
      until: days === undefined ? null : new Date(now + days * DAY_MS).toISOString(),
      ...(note ? { note } : {}),
    };
    this.bans = [...this.list(now).filter((other) => other.target !== target), ban];
    this.save("bans.json", { bans: this.bans });
    return ban;
  }

  /** Lifts the ban of `target`; false when there was none. */
  unban(given: string, now: number): boolean {
    const target = banTarget(given);
    const before = this.bans.length;
    this.bans = this.list(now).filter((ban) => ban.target !== target);
    if (this.bans.length === before) return false;
    this.save("bans.json", { bans: this.bans });
    return true;
  }

  /**
   * Reads the ban list again, after the operator edited the file by hand.
   * A file that does not read leaves the list as it was, and throws.
   */
  reload(): void {
    if (this.directory === undefined) return;
    const text = readIfAny(this.file("bans.json"));
    const now = Date.now();
    // Bans that ran out are dropped, and leave the file at its next write.
    this.bans =
      text === undefined
        ? []
        : parseBans(text).filter((ban) => ban.until === null || Date.parse(ban.until) > now);
  }

  /** Writes the reports not yet written, as the server stops. */
  flush(): void {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save("reports.json", { reports: this.reports });
  }

  private saveReportsSoon(): void {
    if (this.directory === undefined || this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        this.save("reports.json", { reports: this.reports });
      } catch {
        // Tried again with the next report, or at the stop.
      }
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  private prune(now: number): void {
    const since = now - REPORT_DAYS * DAY_MS;
    this.reports = this.reports.filter((r) => Date.parse(r.at) >= since).slice(-MAX_REPORTS);
  }

  private file(name: string): string {
    return join(this.directory ?? "", "moderation", name);
  }

  private save(name: string, content: unknown): void {
    if (this.directory === undefined) return;
    writePrivate(this.file(name), `${JSON.stringify(content, null, 2)}\n`);
  }

  private loadKey(): Buffer {
    if (this.directory === undefined) return randomBytes(32);
    const file = this.file("key");
    const text = readIfAny(file);
    if (text !== undefined && /^[0-9a-f]{64}\s*$/.test(text))
      return Buffer.from(text.trim(), "hex");
    const key = randomBytes(32);
    writePrivate(file, `${key.toString("hex")}\n`);
    return key;
  }
}

function parseBans(text: string): Ban[] {
  const json = JSON.parse(text) as { bans?: unknown };
  if (!Array.isArray(json.bans)) throw new Error('bans.json: expected { "bans": [...] }');
  return json.bans.map((entry: unknown, index) => {
    const { target, until, note } = (entry ?? {}) as Record<string, unknown>;
    const at = `bans.json, entry ${String(index + 1)}`;
    if (typeof target !== "string" || !validTarget(target))
      throw new Error(`${at}: target must be an IP address or a 16-character reference`);
    if (
      until !== undefined &&
      until !== null &&
      (typeof until !== "string" || Number.isNaN(Date.parse(until)))
    )
      throw new Error(`${at}: until must be a date, such as 2026-12-01, or null`);
    if (note !== undefined && typeof note !== "string") throw new Error(`${at}: note must be text`);
    return {
      target: banTarget(target),
      until: typeof until === "string" ? new Date(until).toISOString() : null,
      ...(note ? { note } : {}),
    };
  });
}

function parseReports(text: string): Report[] {
  try {
    const json = JSON.parse(text) as { reports?: unknown };
    return Array.isArray(json.reports) ? (json.reports as Report[]) : [];
  } catch {
    // Reports are a help to the operator, not a record to defend: an unreadable file starts afresh.
    return [];
  }
}
