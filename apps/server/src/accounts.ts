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

/**
 * A player who signed in. The server knows them by a keyed hash of the id
 * the service gave them, and keeps nothing else from that service: no email,
 * no picture, no name but the one they play under.
 */
export interface Account {
  readonly id: string;
  readonly provider: Provider;
  /** HMAC of the service's id, keyed by the file's salt: the file alone does not tell who it is. */
  readonly subject: string;
  /** The name the player plays under, reserved for them. */
  name: string;
  readonly createdAt: number;
  /** Last sign-in, by the day: an account unused for years can be told apart. */
  seenAt: number;
  /** Raised on every sign-out: the session cookies made before it no longer count. */
  sessions: number;
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
  signIn(provider: Provider, providerId: string, suggested: string, now: number): Account {
    const subject = this.subject(provider, providerId);
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

  private subject(provider: Provider, providerId: string): string {
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

function isAccount(value: unknown): value is Account {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.provider === "string" &&
    isProvider(value.provider) &&
    typeof value.subject === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.seenAt === "number" &&
    Number.isInteger(value.sessions)
  );
}
