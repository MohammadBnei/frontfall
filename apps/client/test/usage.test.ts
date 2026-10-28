import { parseUsageReport } from "@frontfall/protocol";
import { describe, expect, it } from "vitest";
import { deviceOf, Usage, type GameFacts, type UsageEnvironment } from "../src/usage.ts";

const FACTS: GameFacts = {
  mode: "solo",
  map: "world",
  teams: 0,
  nations: true,
  bots: 20,
  humans: 1,
  difficulty: "normal",
  disabled: 0,
  view: "flat",
};

function environment(overrides: Partial<UsageEnvironment> = {}) {
  const sent: { url: string; body: string }[] = [];
  const env: UsageEnvironment = {
    href: "https://nclsmgr.com/frontfall/?map=world",
    origin: "https://nclsmgr.com",
    optedOut: false,
    automated: false,
    coarsePointer: false,
    screenSide: 1080,
    send: (url, body) => sent.push({ url, body }),
    randomBytes: (count) => new Uint8Array(count).fill(171),
    ...overrides,
  };
  const reports = () => sent.map(({ body }) => JSON.parse(body) as Record<string, unknown>);
  return { env, sent, reports };
}

describe("deviceOf", () => {
  it("tells phones and tablets from computers", () => {
    expect(deviceOf(false, 400)).toBe("desktop");
    expect(deviceOf(true, 390)).toBe("phone");
    expect(deviceOf(true, 820)).toBe("tablet");
    expect(deviceOf(true, 1200)).toBe("desktop");
  });
});

describe("Usage", () => {
  it("reports the delay of the first order, once, and none when there was none", () => {
    const { env, reports } = environment();
    const usage = new Usage(env);
    const ordered = usage.track(FACTS, 0);
    ordered.firstOrder(12_400);
    ordered.firstOrder(50_000);
    ordered.end("defeat", 90_000);
    usage.track(FACTS, 0).end("left", 30_000);
    expect(reports()[0]).toMatchObject({ firstOrder: 12 });
    expect(reports()[1]).not.toHaveProperty("firstOrder");
  });

  it("reports a game once, under the page's prefix, in a shape the server accepts", () => {
    const { env, sent, reports } = environment({ coarsePointer: true, screenSide: 390 });
    const tracker = new Usage(env).track(FACTS, 0);
    tracker.end("victory", 90_000);
    tracker.end("closed", 120_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://nclsmgr.com/frontfall/api/usage");
    expect(parseUsageReport(sent[0]?.body ?? "").ok).toBe(true);
    expect(reports()[0]).toMatchObject({
      kind: "game",
      game: "abababababababab",
      outcome: "victory",
      minutes: 1.5,
      device: "phone",
      touch: true,
    });
  });

  it("takes one vote per game, after it ended, and a reason only with a thumbs down", () => {
    const { env, reports } = environment();
    const tracker = new Usage(env).track(FACTS, 0);
    tracker.vote("up");
    expect(reports()).toHaveLength(0);
    tracker.end("defeat", 1000);
    tracker.vote("down", "too_hard");
    tracker.vote("up");
    const votes = reports().filter((report) => report.kind === "feedback");
    expect(votes).toEqual([
      {
        kind: "feedback",
        release: "0.0.0",
        game: "abababababababab",
        mode: "solo",
        outcome: "defeat",
        vote: "down",
        reason: "too_hard",
      },
    ]);
  });

  it("sends nothing when the browser asks not to be tracked, or a test tool drives it", () => {
    for (const overrides of [{ optedOut: true }, { automated: true }]) {
      const { env, sent } = environment(overrides);
      const usage = new Usage(env);
      usage.track(FACTS, 0).end("left", 1);
      usage.error("webgl");
      expect(sent).toHaveLength(0);
    }
  });

  it("sends an error's message only from the game's own code, scrubbed, five at most", () => {
    const { env, sent, reports } = environment();
    const usage = new Usage(env);
    usage.error(
      "exception",
      'Bad tile 1234 for "Léa"',
      "https://nclsmgr.com/frontfall/assets/index.js",
    );
    usage.error("exception", "secret of an extension", "chrome-extension://abc/content.js");
    for (let index = 0; index < 10; index++) usage.error("rejection");
    expect(sent).toHaveLength(5);
    expect(reports()[0]).toEqual({
      kind: "error",
      release: "0.0.0",
      type: "exception",
      message: "Bad tile # for <text>",
    });
    expect(reports()[1]).toEqual({ kind: "error", release: "0.0.0", type: "exception" });
  });
});
