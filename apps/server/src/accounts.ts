import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_NAME_LENGTH, normalizeName } from "@frontfall/protocol";

/** Services a player may sign in with. */
export const PROVIDERS = ["discord", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** How a player signed in: at a service, or with a link sent to their email address. */
export type SignInMethod = Provider | "email";

function isSignInMethod(value: string): value is SignInMethod {
  return value === "email" || isProvider(value);
}

/**
 * Achievements of an account, as the page counts them: the level and first
 * day of each one earned, and the counts behind the tiers. Kept so that they
 * follow the player from one device to another.
 */
export interface AccountAchievements {
  earned: Record<string, { at: number; level: number }>;
  counts: Record<string, number>;
}

/** An achievement id or a count's name, as the page writes them. */
const ACHIEVEMENT_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_ACHIEVEMENTS = 64;
const MAX_COUNTERS = 8;
const MAX_LEVEL = 3;
const MAX_COUNT = 1_000_000_000;

/**
 * A player who signed in. The server knows them by a keyed hash of the id
 * the service gave them, or of their email address, and keeps nothing else:
 * no address, no picture, no name but the one they play under.
 */
export interface Account {
  readonly id: string;
  readonly provider: SignInMethod;
  /**
   * HMAC of the service's id or of the email address, keyed by the file's
   * salt: the file alone does not tell who it is.
   */
  readonly subject: string;
  /** The name the player plays under, reserved for them. */
  name: string;
  readonly createdAt: number;
  /** Last sign-in, by the day: an account unused for years can be told apart. */
  seenAt: number;
  /** Raised on every sign-out: the session cookies made before it no longer count. */
  sessions: number;
  /** Achievements the page has sent, once it has. */
  achievements?: AccountAchievements;
}

export type RenameResult =
  { ok: true; name: string } | { ok: false; error: "invalid" | "taken"; message: string };

const FILE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two names that look alike to players are the same name: case, accents
 * aside, spaces and punctuation do not tell them apart.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The accounts file, under the server's data directory. */
export function accountsFile(dataDir: string): string {
  return join(dataDir, "accounts", "accounts.json");
}

/**
 * The accounts, all in memory and written to one file after each change.
 * Sign-ups and renames are rare next to games: a file holds tens of
 * thousands of accounts before it needs a database.
 */
export class Accounts {
  private readonly byId = new Map<string, Account>();
  private readonly bySubject = new Map<string, Account>();
  private readonly byName = new Map<string, Account>();
  /**
   * Key the services' ids are hashed with, drawn once when the file is
   * created and kept in it: the accounts depend on no setting of the server.
   */
  private salt = randomBytes(32).toString("base64url");

  /** @param file where the accounts are kept; unset keeps them in memory only, for tests. */
  constructor(private readonly file: string | undefined) {}

  get size(): number {
    return this.byId.size;
  }

  /**
   * Reads the file; a missing one is a first start. One that cannot be read,
   * as with wrong permissions, is an error the accounts cannot start with:
   * the next write would replace it. One that can be read but not understood
   * is kept aside, and the accounts start empty.
   */
  load(): { error?: Error; usable: boolean } {
    if (this.file === undefined) return { usable: true };
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { usable: true };
      return { error: error as Error, usable: false };
    }
    if (this.restore(text)) return { usable: true };
    const aside = `${this.file}.broken-${String(Date.now())}`;
    try {
      renameSync(this.file, aside);
    } catch {
      // Left in place: the next write replaces it.
    }
    return { error: new Error(`unreadable accounts, kept as ${aside}`), usable: true };
  }

  get(id: string): Account | undefined {
    return this.byId.get(id);
  }

  /** The account holding this name, or one that looks like it. */
  owner(name: string): Account | undefined {
    return this.byName.get(nameKey(name));
  }

  /**
   * The account of this player at this service, made on their first sign-in
   * under the name they have there, cleaned, or another free one.
   */
  signIn(provider: SignInMethod, providerId: string, suggested: string, now: number): Account {
    return this.signInAs(provider, this.subject(provider, providerId), suggested, now);
  }

  /** As `signIn`, for a subject already hashed with `subject`. */
  signInAs(provider: SignInMethod, subject: string, suggested: string, now: number): Account {
    const found = this.bySubject.get(subject);
    if (found) {
      // Written at most once a day, not at every sign-in.
      if (now - found.seenAt >= DAY_MS) {
        found.seenAt = dayOf(now);
        this.save();
      }
      return found;
    }
    const account: Account = {
      id: randomBytes(12).toString("base64url"),
      provider,
      subject,
      name: this.freeName(suggested),
      createdAt: dayOf(now),
      seenAt: dayOf(now),
      sessions: 0,
    };
    this.add(account);
    this.save();
    return account;
  }

  rename(id: string, raw: string): RenameResult {
    const account = this.byId.get(id);
    const checked = normalizeName(raw);
    if (!account) return { ok: false, error: "invalid", message: "no such account" };
    if (!checked.ok) return { ok: false, error: "invalid", message: checked.error };
    const holder = this.owner(checked.name);
    if (holder && holder !== account)
      return { ok: false, error: "taken", message: "this name belongs to another account" };
    this.byName.delete(nameKey(account.name));
    account.name = checked.name;
    this.byName.set(nameKey(account.name), account);
    this.save();
    return { ok: true, name: account.name };
  }

  /** Ends every session of the account, on every device. */
  signOut(id: string): void {
    const account = this.byId.get(id);
    if (!account) return;
    account.sessions++;
    this.save();
  }

  /** Deletes an account at its owner's request: nothing of it is left in the file. */
  remove(id: string): boolean {
    const account = this.byId.get(id);
    if (!account) return false;
    this.byId.delete(id);
    this.bySubject.delete(account.subject);
    this.byName.delete(nameKey(account.name));
    this.save();
    return true;
  }

  /**
   * Adds what the page sends to the achievements of the account, and returns
   * them all. Nothing is ever taken away: a level only rises, a first day
   * only moves earlier, a count only grows. Two devices played apart between
   * two syncs keep the larger count of the two, not their sum.
   */
  mergeAchievements(id: string, sent: AccountAchievements): AccountAchievements | undefined {
    const account = this.byId.get(id);
    if (!account) return undefined;
    const kept: AccountAchievements = account.achievements ?? { earned: {}, counts: {} };
    let changed = account.achievements === undefined;
    for (const [key, { at, level }] of Object.entries(sent.earned)) {
      const before = Object.hasOwn(kept.earned, key) ? kept.earned[key] : undefined;
      if (!before && Object.keys(kept.earned).length >= MAX_ACHIEVEMENTS) continue;
      const merged = before
        ? { at: Math.min(before.at, at), level: Math.max(before.level, level) }
        : { at, level };
      if (!before || merged.at !== before.at || merged.level !== before.level) {
        kept.earned[key] = merged;
        changed = true;
      }
    }
    for (const [key, count] of Object.entries(sent.counts)) {
      const before = Object.hasOwn(kept.counts, key) ? kept.counts[key] : undefined;
      if (before === undefined && Object.keys(kept.counts).length >= MAX_COUNTERS) continue;
      if (before === undefined || count > before) {
        kept.counts[key] = count;
        changed = true;
      }
    }
    account.achievements = kept;
    if (changed) this.save();
    return kept;
  }

  /** The hash an account of this method and id is known by. */
  subject(provider: SignInMethod, providerId: string): string {
    return createHmac("sha256", this.salt)
      .update(`account:${provider}:${providerId}`)
      .digest("base64url");
  }

  /** The suggested name if it is allowed and free, else a free one close to it. */
  private freeName(suggested: string): string {
    const checked = normalizeName(cleanSuggestion(suggested));
    const base = checked.ok ? checked.name : "Player";
    if (!this.owner(base)) return base;
    for (let attempt = 0; ; attempt++) {
      // Four digits, then more as the short ones run out.
      const digits = String(
        1000 + Math.floor(Math.random() * 9000 * 10 ** Math.floor(attempt / 50)),
      );
      const name = `${Array.from(base)
        .slice(0, MAX_NAME_LENGTH - digits.length)
        .join("")
        .trimEnd()}${digits}`;
      if (normalizeName(name).ok && !this.owner(name)) return name;
    }
  }

  private add(account: Account): void {
    this.byId.set(account.id, account);
    this.bySubject.set(account.subject, account);
    this.byName.set(nameKey(account.name), account);
  }

  private restore(text: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== FILE_VERSION ||
      typeof parsed.salt !== "string" ||
      parsed.salt.length < 32 ||
      !Array.isArray(parsed.accounts)
    )
      return false;
    const accounts = parsed.accounts.filter(isAccount);
    if (accounts.length !== parsed.accounts.length) return false;
    this.salt = parsed.salt;
    for (const account of accounts) this.add({ ...account });
    return true;
  }

  /** Readable by the server's user only, replaced at once so that a crash never leaves half a file. */
  private save(): void {
    if (this.file === undefined) return;
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    const body = JSON.stringify({
      version: FILE_VERSION,
      salt: this.salt,
      accounts: [...this.byId.values()],
    });
    writeFileSync(temporary, body, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.file);
  }
}

/** Keeps the characters a player name allows, so that "x_Bob_x" becomes "xBobx", not "Player". */
function cleanSuggestion(raw: string): string {
  return Array.from(
    raw
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, "")
      .replace(/^[^\p{L}\p{M}\p{N}]+/u, "")
      .trim(),
  )
    .slice(0, MAX_NAME_LENGTH)
    .join("")
    .trimEnd();
}

function dayOf(time: number): number {
  return time - (time % DAY_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isAccount(value: unknown): value is Account {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    isSignInMethod(value.provider) &&
    typeof value.subject === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.seenAt === "number" &&
    Number.isInteger(value.sessions) &&
    (value.achievements === undefined || parseAchievements(value.achievements) !== undefined)
  );
}

/**
 * Achievements as the page sends them, checked: known shapes and sizes only,
 * so that an account's share of the file stays small. Undefined when they
 * are not achievements at all.
 */
export function parseAchievements(value: unknown): AccountAchievements | undefined {
  if (!isRecord(value) || !isPlainRecord(value.earned) || !isPlainRecord(value.counts))
    return undefined;
  const earned: AccountAchievements["earned"] = {};
  const counts: AccountAchievements["counts"] = {};
  const earnedEntries = Object.entries(value.earned);
  const countEntries = Object.entries(value.counts);
  if (earnedEntries.length > MAX_ACHIEVEMENTS || countEntries.length > MAX_COUNTERS)
    return undefined;
  for (const [key, entry] of earnedEntries) {
    if (!ACHIEVEMENT_KEY.test(key) || !isPlainRecord(entry)) return undefined;
    const { at, level } = entry;
    if (
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      at < 0 ||
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > MAX_LEVEL
    )
      return undefined;
    earned[key] = { at, level };
  }
  for (const [key, count] of countEntries) {
    if (
      !ACHIEVEMENT_KEY.test(key) ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_COUNT
    )
      return undefined;
    counts[key] = count;
  }
  return { earned, counts };
}
