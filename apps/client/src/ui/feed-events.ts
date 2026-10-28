import type { DiplomacyEvent, GameUpdate, StructureType } from "../game/game-view.ts";
import { t, type MessageKey } from "../i18n/index.ts";

/** How a feed entry looks and how it is read: bad news, good news, a plain fact, or a question for you. */
export type FeedTone = "bad" | "good" | "info" | "ask";

export interface FeedEntry {
  /** Entries with the same key merge into one, counted. */
  key: string;
  tone: FeedTone;
  text: string;
  /** What a click shows: a tile of the map, else the land of a player. */
  tile?: number;
  player?: number;
  /** Concerns the player at this screen, who reads it before the rest. */
  mine: boolean;
}

/** Land taken from you in one update, by who took it: the first tile of each. */
export type LandLost = ReadonlyMap<number, number>;

/** Ticks before the same player is reported again as taking your land. */
const ATTACK_QUIET_TICKS = 150;

const EVENT_TEXT: Readonly<Record<DiplomacyEvent["type"], MessageKey>> = {
  allied: "diplo.eventAllied",
  ended: "diplo.eventEnded",
  betrayed: "diplo.eventBetrayed",
  embargo: "diplo.eventEmbargo",
  lifted: "diplo.eventLifted",
  captured: "diplo.eventCaptured",
  missile: "diplo.eventMissile",
  stopped: "diplo.eventStopped",
  gift: "diplo.eventGift",
  quick: "diplo.eventQuick",
};

const STRUCTURE_TEXT: Readonly<Record<StructureType, MessageKey>> = {
  city: "hud.city",
  palace: "hud.palace",
  fort: "hud.fort",
  port: "hud.port",
  silo: "hud.silo",
  airDefense: "hud.airDefense",
};

/** Land that changed hands this update and was the player's: who took it, and where first. */
export function landLost(
  update: Pick<GameUpdate, "you" | "changedTiles" | "changedOwners">,
  ownerAt: (tile: number) => number,
): LandLost {
  const lost = new Map<number, number>();
  const { changedTiles, changedOwners } = update;
  for (let i = 0; i < changedTiles.length; i++) {
    const tile = changedTiles[i] as number;
    const taker = changedOwners[i] as number;
    if (taker === update.you || taker === 0 || ownerAt(tile) !== update.you) continue;
    if (!lost.has(taker)) lost.set(taker, tile);
  }
  return lost;
}

const pair = (a: number, b: number): string =>
  a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;

/**
 * Turns what the game reports into the feed's entries, from the updates in
 * order: the diplomacy events the engine logs, and what the player's own
 * screen can tell by comparing two updates (a request, land taken, a building
 * lost). It also keeps who is allied with whom, from the events alone.
 */
export class FeedWatcher {
  private started = false;
  private requests = new Set<number>();
  private structures = new Map<number, { type: StructureType; tile: number }>();
  private readonly attackedAt = new Map<number, number>();
  private readonly alliances = new Set<string>();

  /** `personal` is false in a replay, where nobody is the player. */
  constructor(private readonly personal: boolean) {}

  /** Players allied with `id` that the events of this game told of, not counting the player at this screen. */
  alliesOf(id: number): number[] {
    const allies: number[] = [];
    for (const key of this.alliances) {
      const [a, b] = key.split(":").map(Number) as [number, number];
      if (a === id) allies.push(b);
      else if (b === id) allies.push(a);
    }
    return allies;
  }

  /**
   * The entries `update` adds. `ownerAt` reads the map as it is after the
   * update, and `lost` the land the update took from the player.
   */
  observe(update: GameUpdate, lost: LandLost, ownerAt: (tile: number) => number): FeedEntry[] {
    const entries: FeedEntry[] = [];
    const name = (id: number): string => update.players.find((p) => p.id === id)?.name ?? "";
    for (const event of update.events) {
      this.track(event);
      const entry = this.eventEntry(event, update.you, name);
      if (entry) entries.push(entry);
    }
    const requests = new Set(update.diplomacy.incoming.map((r) => r.from));
    const structures = new Map<number, { type: StructureType; tile: number }>();
    for (const s of update.structures) {
      if (s.player === update.you) structures.set(s.id, { type: s.type, tile: s.tile });
    }
    if (this.started && this.personal) {
      for (const from of requests) {
        if (this.requests.has(from)) continue;
        entries.push({
          key: `request:${String(from)}`,
          tone: "ask",
          text: t("feed.request", { name: name(from) }),
          player: from,
          mine: true,
        });
      }
      for (const [taker, tile] of lost) {
        const last = this.attackedAt.get(taker);
        if (last !== undefined && update.tick - last < ATTACK_QUIET_TICKS) continue;
        this.attackedAt.set(taker, update.tick);
        entries.push({
          key: `attacked:${String(taker)}`,
          tone: "bad",
          text: t("feed.attacked", { name: name(taker) }),
          tile,
          player: taker,
          mine: true,
        });
      }
      for (const [id, structure] of this.structures) {
        if (structures.has(id) || ownerAt(structure.tile) === update.you) continue;
        entries.push({
          key: `lost:${structure.type}`,
          tone: "bad",
          text: t("feed.lost", { what: t(STRUCTURE_TEXT[structure.type]) }),
          tile: structure.tile,
          mine: true,
        });
      }
    }
    this.started = true;
    this.requests = requests;
    this.structures = structures;
    return entries;
  }

  private track(event: DiplomacyEvent): void {
    const key = pair(event.a, event.b);
    if (event.type === "allied") this.alliances.add(key);
    else if (event.type === "ended" || event.type === "betrayed") this.alliances.delete(key);
  }

  /** Whether the event is good or bad news for the player, who is `a` or `b` of it. */
  private tone(event: DiplomacyEvent, you: number): FeedTone {
    const target = event.b === you;
    switch (event.type) {
      case "allied":
        return "good";
      case "lifted":
      case "gift":
        return target ? "good" : "info";
      case "stopped":
        return target ? "bad" : "good";
      case "betrayed":
      case "embargo":
      case "captured":
      case "missile":
        return target ? "bad" : "info";
      case "ended":
      case "quick":
        return "info";
    }
  }

  private eventEntry(
    event: DiplomacyEvent,
    you: number,
    name: (id: number) => string,
  ): FeedEntry | undefined {
    // A quick message is for its sender and its receiver only (R-DIPLO-07).
    if (event.type === "quick" && event.a !== you && event.b !== you) return undefined;
    const mine = this.personal && (event.a === you || event.b === you);
    const other = event.a === you ? event.b : event.a;
    const tone = mine ? this.tone(event, you) : "info";
    const text = t(EVENT_TEXT[event.type], {
      a: name(event.a),
      b: name(event.b),
      phrase: event.phrase === undefined ? "" : t(`quick.${String(event.phrase)}` as MessageKey),
    });
    return {
      key: `${event.type}:${String(event.a)}:${String(event.b)}:${String(event.phrase ?? "")}`,
      tone,
      text,
      player: mine ? other : event.a,
      mine,
    };
  }
}
