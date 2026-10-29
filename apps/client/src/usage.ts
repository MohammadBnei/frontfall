import {
  scrubMessage,
  type BrowserFamily,
  type ClientErrorType,
  type ErrorScreen,
  type Device,
  type FeedbackReason,
  type GameReport,
  type Outcome,
  type UsageMode,
  type UsageReport,
} from "@frontfall/protocol";
import { getLanguage } from "./i18n/index.ts";
import { RELEASE } from "./release.ts";

/**
 * What the page tells its own server about the games played on it
 * (docs/privacy.md): counts, never who played. The reports are not kept in
 * the browser (the player's own profile, in ui/profile.ts, is), and nothing
 * is sent when the browser asks sites not to track.
 */

/** Error reports one page load sends at most. */
const MAX_ERRORS = 5;

/** The parts of the browser this module reads, so tests can supply their own. */
export interface UsageEnvironment {
  readonly href: string;
  readonly origin: string;
  /** Do Not Track or Global Privacy Control is on. */
  readonly optedOut: boolean;
  /** Driven by a test tool, whose games are not players' games. */
  readonly automated: boolean;
  readonly coarsePointer: boolean;
  /** Smaller side of the screen, in CSS pixels. */
  readonly screenSide: number;
  readonly userAgent: string;
  /** Sends a body to a URL, surviving the page being closed. */
  send(url: string, body: string): void;
  randomBytes(count: number): Uint8Array;
}

/**
 * An end-to-end test of these reports asks for them with ?usage. Read when
 * the page loads, before the address bar is rewritten.
 */
const askedFor =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("usage");

function browser(): UsageEnvironment {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    href: location.href,
    origin: location.origin,
    optedOut: nav.globalPrivacyControl === true || nav.doNotTrack === "1",
    automated: nav.webdriver && !askedFor,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    screenSide: Math.min(screen.width, screen.height),
    userAgent: nav.userAgent,
    send(url, body) {
      // A beacon outlives the page; without one, a request that is kept alive.
      if ("sendBeacon" in nav && nav.sendBeacon(url, body)) return;
      void fetch(url, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "text/plain" },
      }).catch(() => undefined);
    },
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  };
}

/** Phone, tablet or computer, from the pointer and the size of the screen. */
export function deviceOf(coarsePointer: boolean, screenSide: number): Device {
  if (!coarsePointer) return "desktop";
  return screenSide < 600 ? "phone" : screenSide < 1000 ? "tablet" : "desktop";
}

/** The family of a browser's engine, from its user agent; every browser on iOS is Safari's. */
export function browserOf(userAgent: string): BrowserFamily {
  if (/CriOS|FxiOS|EdgiOS|iPhone|iPad/.test(userAgent)) return "safari";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\/|Chromium\//.test(userAgent)) return "chromium";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

/**
 * Where in the game's own code an error came from, as `file:line:column`
 * without the address: `source` is a script's address with its line and
 * column, or a stack in which the first of the page's own frames is taken.
 * Undefined for code from elsewhere, such as a browser extension.
 */
export function whereOf(source: string | undefined, origin: string): string | undefined {
  if (!source) return undefined;
  for (const match of source.matchAll(/([a-z-]+:\/\/[^\s()@]+?):(\d+):(\d+)/g)) {
    const [, url = "", line = "", column = ""] = match;
    if (!url.startsWith(`${origin}/`)) continue;
    const file = (url.split(/[?#]/)[0] ?? "").split("/").at(-1) ?? "";
    if (!/^[\w.-]{1,77}\.m?js$/.test(file) || line.length > 7 || column.length > 7) {
      return undefined;
    }
    return `${file}:${line}:${column}`;
  }
  return undefined;
}

/** What a game report says about the game itself, known when it starts. */
export type GameFacts = Pick<
  GameReport,
  | "mode"
  | "map"
  | "teams"
  | "nations"
  | "bots"
  | "humans"
  | "difficulty"
  | "disabled"
  | "rules"
  | "view"
>;

/** One game played on this page, reported once when it ends for the player. */
export class GameTracker {
  /** Drawn for this game only, so the server counts it once. */
  readonly key: string;
  private outcome: Outcome | undefined;
  private voted = false;
  private firstOrderAt: number | undefined;

  constructor(
    private readonly usage: Usage,
    private readonly facts: GameFacts,
    private readonly startedAt: number,
  ) {
    this.key = usage.newKey();
  }

  get mode(): UsageMode {
    return this.facts.mode;
  }

  /** How the game ended for the player, once known. */
  get ended(): Outcome | undefined {
    return this.outcome;
  }

  /** The player's first order once play began; only the first counts. */
  firstOrder(now: number): void {
    this.firstOrderAt ??= now;
  }

  /** Reports the game; later calls do nothing, so the first ending is the one counted. */
  end(outcome: Outcome, now: number): void {
    if (this.outcome) return;
    this.outcome = outcome;
    const minutes = Math.min(24 * 60, Math.max(0, (now - this.startedAt) / 60_000));
    this.usage.ended({ map: this.facts.map, mode: this.facts.mode, outcome, minutes, at: now });
    this.usage.send({
      kind: "game",
      release: RELEASE,
      game: this.key,
      ...this.facts,
      minutes,
      outcome,
      ...(this.firstOrderAt === undefined
        ? {}
        : { firstOrder: Math.max(0, Math.round((this.firstOrderAt - this.startedAt) / 1000)) }),
      ...this.usage.device(),
      lang: getLanguage(),
    });
  }

  /** The player's thumbs up or down on the end screen; one per game. */
  vote(vote: "up" | "down", reason?: FeedbackReason): void {
    if (this.voted || !this.outcome) return;
    this.voted = true;
    this.usage.send({
      kind: "feedback",
      release: RELEASE,
      game: this.key,
      mode: this.facts.mode,
      outcome: this.outcome,
      vote,
      ...(reason && vote === "down" ? { reason } : {}),
    });
  }
}

/** A game that has ended for the player, as the page itself may want to remember it. */
export interface EndedGame {
  map: string;
  mode: UsageMode;
  outcome: Outcome;
  minutes: number;
  at: number;
}

export class Usage {
  private errors = 0;
  /** Where the page is, said in the error reports. */
  screen: ErrorScreen = "menu";
  private readonly endListeners: ((game: EndedGame) => void)[] = [];
  private readonly url: string;

  constructor(private readonly env: UsageEnvironment = browser()) {
    this.url = new URL("api/usage", env.href).href;
  }

  /** Whether anything is sent at all. */
  get enabled(): boolean {
    return !this.env.optedOut && !this.env.automated;
  }

  newKey(): string {
    return Array.from(this.env.randomBytes(8), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  device(): Pick<GameReport, "device" | "touch"> {
    return {
      device: deviceOf(this.env.coarsePointer, this.env.screenSide),
      touch: this.env.coarsePointer,
    };
  }

  /** Calls `listener` when a game ends, whether or not anything is sent: for the page's own use. */
  onGameEnd(listener: (game: EndedGame) => void): void {
    this.endListeners.push(listener);
  }

  ended(game: EndedGame): void {
    for (const listener of this.endListeners) listener(game);
  }

  /** A game that starts now. */
  track(facts: GameFacts, now: number): GameTracker {
    return new GameTracker(this, facts, now);
  }

  /**
   * An error. Its message and the place it came from go along only when it
   * comes from the game's own code, and without addresses, quoted text or
   * numbers. `source` is the address of the script, with its line and column,
   * or the stack of the error; none for an error the game itself raises.
   */
  error(type: ClientErrorType, message?: string, source?: string): void {
    if (this.errors >= MAX_ERRORS) return;
    this.errors++;
    // A stack holds the error's message too, which is no place in the code.
    const where = whereOf(message ? source?.split(message).join("") : source, this.env.origin);
    const own = source === undefined || where !== undefined;
    const text = message && own ? scrubMessage(message) : "";
    this.send({
      kind: "error",
      release: RELEASE,
      type,
      ...(text ? { message: text } : {}),
      ...(where ? { where } : {}),
      browser: browserOf(this.env.userAgent),
      device: deviceOf(this.env.coarsePointer, this.env.screenSide),
      screen: this.screen,
    });
  }

  send(report: UsageReport): void {
    if (this.enabled) this.env.send(this.url, JSON.stringify(report));
  }
}

let shared: Usage | undefined;

/** The page's reports, created on first use. */
export function usage(): Usage {
  shared ??= new Usage();
  return shared;
}
