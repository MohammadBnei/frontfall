import type { GameRules } from "../game/messages.ts";
import type { GameUpdate } from "../game/game-view.ts";
import { t } from "../i18n/index.ts";
import { colorOf } from "../palette.ts";
import { h, swatch } from "./dom.ts";
import { formatCount, formatPercent } from "./format.ts";

type TipRules = Pick<GameRules, "ticksPerSecond" | "firstNation" | "teams" | "ownableTiles">;

/** What the player at this screen is to `id`, in words, with the embargoes that apply. */
export function relation(update: GameUpdate, id: number, rules: TipRules): string {
  if (id === update.you) return t("tip.you");
  const { diplomacy } = update;
  const ally = diplomacy.allies.find((a) => a.id === id);
  const parts: string[] = [];
  if (diplomacy.teammates.includes(id)) parts.push(t("tip.teammate"));
  else if (ally) {
    parts.push(t("tip.allyFor", { seconds: Math.ceil(ally.ticksLeft / rules.ticksPerSecond) }));
  } else if (id >= rules.firstNation) parts.push(t("tip.nation"));
  else if (diplomacy.atWar.includes(id)) parts.push(t("tip.atWar"));
  else parts.push(t("tip.notAllied"));
  const traitor = diplomacy.traitors.find((x) => x.id === id);
  if (traitor) {
    parts.push(t("tip.traitor", { seconds: Math.ceil(traitor.ticksLeft / rules.ticksPerSecond) }));
  }
  if (diplomacy.embargoes.includes(id)) parts.push(t("tip.embargoing"));
  if (diplomacy.embargoedBy.includes(id)) parts.push(t("tip.embargoedBy"));
  return parts.join(" · ");
}

/** Troops out of their cap, gold, and the share of the map: one line. */
export function facts(update: GameUpdate, id: number, rules: TipRules): string {
  const player = update.players.find((p) => p.id === id);
  if (!player) return "";
  return t("tip.facts", {
    troops: formatCount(Math.floor(player.troops)),
    cap: formatCount(Math.floor(player.cap)),
    gold: formatCount(Math.floor(player.gold)),
    land: formatPercent(player.tiles / Math.max(1, rules.ownableTiles)),
  });
}

/**
 * The card of the player whose land the pointer rests on: name, how they
 * stand with you, who they are allied with, troops, gold and land. A mouse
 * convenience; on a touch screen the long press opens the player menu, and
 * the keyboard has the leaderboard, which shows the same things.
 */
export class PlayerTip {
  readonly element = h("div", {
    class: "panel player-tip",
    id: "player-tip",
    role: "tooltip",
    hidden: true,
  });
  private owner = 0;
  /** A mouse has moved over the map: until then the pointer position is unknown. */
  private mouse = false;
  private x = 0;
  private y = 0;
  private key = "";
  private rules: TipRules = {
    ticksPerSecond: 10,
    firstNation: Infinity,
    teams: [],
    ownableTiles: 1,
  };
  private last: GameUpdate | undefined;

  constructor(private readonly alliesOf: (id: number) => number[]) {}

  setRules(rules: TipRules): void {
    this.rules = rules;
  }

  /** Follows the mouse over `surface`; a finger or a drag shows nothing. */
  track(surface: HTMLElement): () => void {
    const move = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      this.mouse = true;
      this.x = event.clientX;
      this.y = event.clientY;
      if (event.buttons !== 0) this.hide();
      else this.place();
    };
    const leave = (): void => {
      this.over(0);
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    surface.addEventListener("wheel", leave, { passive: true });
    return () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      surface.removeEventListener("wheel", leave);
    };
  }

  /** The pointer is over the land of `owner`, 0 for none. */
  over(owner: number): void {
    this.owner = owner;
    this.render();
  }

  hide(): void {
    this.element.hidden = true;
    this.key = "";
  }

  update(update: GameUpdate): void {
    this.last = update;
    if (this.owner !== 0) this.render();
  }

  private render(): void {
    const update = this.last;
    const id = this.owner;
    const player = update?.players.find((p) => p.id === id);
    if (!update || !player?.alive || id === 0 || !this.mouse) {
      this.hide();
      return;
    }
    const allies = this.alliesOf(id)
      .map((ally) => update.players.find((p) => p.id === ally))
      .filter((p) => p?.alive === true)
      .map((p) => p?.name ?? "");
    const lines = [
      relation(update, id, this.rules),
      facts(update, id, this.rules),
      ...(allies.length > 0 ? [t("tip.allies", { names: allies.join(", ") })] : []),
    ];
    const key = [id, player.name, ...lines].join("|");
    if (key !== this.key) {
      this.key = key;
      this.element.replaceChildren(
        h(
          "p",
          { class: "player-tip-name" },
          swatch(colorOf(id, this.rules.firstNation, this.rules.teams)),
          player.name,
        ),
        ...lines.map((line) => h("p", { class: "player-tip-line" }, line)),
      );
    }
    this.element.hidden = false;
    this.place();
  }

  /** By the pointer, kept inside the window. */
  private place(): void {
    if (this.element.hidden) return;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const left = Math.min(this.x + 16, Math.max(0, window.innerWidth - width - 8));
    const below = this.y + 20 + height > window.innerHeight;
    this.element.style.left = `${String(Math.round(left))}px`;
    this.element.style.top = `${String(Math.round(below ? this.y - height - 12 : this.y + 20))}px`;
  }
}
