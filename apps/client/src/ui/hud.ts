import { HUMAN_ID, type GameUpdate, type PlayerView } from "../game/solo-game.ts";
import { applyTranslations, t } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { h } from "./dom.ts";
import { formatCount, formatPercent } from "./format.ts";

/** B-ATTACK-RATIO-MIN and the interface default of R-ATTACK-02, in percent. */
export const MIN_RATIO = 5;
export const DEFAULT_RATIO = 30;
/** The HUD is redrawn at most this often; the map keeps its own pace. */
const REFRESH_MS = 250;
const LEADERBOARD_SIZE = 10;

export interface HudActions {
  onPause(): void;
  onHelp(): void;
}

/**
 * Numbers the player plays by: their troops, gold and land, the attack
 * ratio, what the game expects of them now, and the leading players.
 */
export class Hud {
  readonly element: HTMLElement;
  private readonly troops = h("strong", { class: "stat-value" });
  private readonly troopsCap = h("span", { class: "stat-cap" });
  private readonly gold = h("strong", { class: "stat-value" });
  private readonly land = h("strong", { class: "stat-value" });
  private readonly banner = h(
    "p",
    { class: "banner", role: "status", "aria-live": "polite" },
    t("game.loading"),
  );
  private readonly leaders = h("ol", { class: "leaderboard-list" });
  private readonly ratioInput = h("input", {
    id: "attack-ratio",
    type: "range",
    min: MIN_RATIO,
    max: 100,
    step: 1,
  });
  private readonly ratioValue = h("output", { for: "attack-ratio", class: "range-value" });
  private lastRender = -Infinity;
  private last: GameUpdate | undefined;
  private ownableTiles = 1;

  constructor(actions: HudActions) {
    this.ratioInput.addEventListener("input", () => {
      this.setRatio(Number(this.ratioInput.value));
    });
    this.setRatio(DEFAULT_RATIO);

    const stat = (key: string, ...value: Node[]): HTMLElement =>
      h("div", { class: "stat" }, h("span", { class: "stat-label", "data-i18n": key }), ...value);

    const pause = h("button", {
      type: "button",
      class: "icon-button icon-pause",
      id: "pause",
      "data-i18n-attr": "aria-label:hud.pause;title:hud.pauseKey",
    });
    pause.addEventListener("click", () => {
      actions.onPause();
    });
    const help = h("button", {
      type: "button",
      class: "icon-button icon-help",
      id: "help",
      "data-i18n-attr": "aria-label:help.title;title:help.title",
    });
    help.addEventListener("click", () => {
      actions.onHelp();
    });

    this.element = h(
      "div",
      { class: "hud", id: "hud" },
      h(
        "section",
        { class: "panel stats", "data-i18n-attr": "aria-label:hud.yourEmpire" },
        stat("hud.troops", this.troops, this.troopsCap),
        stat("hud.gold", this.gold),
        stat("hud.land", this.land),
      ),
      this.banner,
      h(
        "section",
        { class: "panel leaderboard", "aria-labelledby": "leaderboard-title" },
        h("h2", { id: "leaderboard-title", "data-i18n": "hud.leaderboard" }),
        this.leaders,
      ),
      h(
        "div",
        { class: "panel ratio" },
        h("label", { for: "attack-ratio", "data-i18n": "hud.ratio" }),
        this.ratioInput,
        this.ratioValue,
      ),
      h("div", { class: "toolbar" }, help, pause),
    );
    applyTranslations(this.element);
  }

  /** Share of troops a new attack takes, in percent. */
  get ratio(): number {
    return Number(this.ratioInput.value);
  }

  setRatio(percent: number): void {
    const value = Math.max(MIN_RATIO, Math.min(100, Math.round(percent)));
    this.ratioInput.value = String(value);
    this.ratioValue.textContent = formatPercent(value / 100);
  }

  setOwnableTiles(count: number): void {
    this.ownableTiles = Math.max(1, count);
  }

  /** Takes every update; draws only a few times per second, or at once when forced. */
  update(update: GameUpdate, now: number, force = false): void {
    const phaseChanged = this.last?.phase !== update.phase;
    this.last = update;
    if (!force && !phaseChanged && now - this.lastRender < REFRESH_MS) return;
    this.lastRender = now;
    this.render(update);
  }

  /** Redraws with the last update, after a language change for example. */
  refresh(): void {
    applyTranslations(this.element);
    if (this.last) this.render(this.last);
  }

  private render(update: GameUpdate): void {
    const human = update.players.find((player) => player.id === HUMAN_ID);
    if (human) {
      this.troops.textContent = formatCount(human.troops);
      this.troopsCap.textContent = t("hud.cap", { cap: formatCount(human.cap) });
      this.gold.textContent = formatCount(human.gold);
      this.land.textContent = formatPercent(human.tiles / this.ownableTiles);
    }
    this.banner.textContent = this.bannerText(update, human);
    this.renderLeaders(update.players);
  }

  private bannerText(update: GameUpdate, human: PlayerView | undefined): string {
    const seconds = Math.ceil(update.spawnTicksLeft / 10);
    if (update.phase === "spawn") {
      return human && human.tiles > 0
        ? t("hud.spawnMove", { seconds })
        : t("hud.spawnPick", { seconds });
    }
    if (human && !human.alive) return t("hud.eliminated");
    if (update.attacks.length > 0) {
      const troops = update.attacks.reduce((sum, attack) => sum + attack.troops, 0);
      return t("hud.attacking", { count: update.attacks.length, troops: formatCount(troops) });
    }
    return t("hud.playHint");
  }

  private renderLeaders(players: readonly PlayerView[]): void {
    const ranked = players
      .filter((player) => player.alive)
      .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
    const shown = ranked.slice(0, LEADERBOARD_SIZE);
    const humanRank = ranked.findIndex((player) => player.id === HUMAN_ID);
    if (humanRank >= LEADERBOARD_SIZE) shown.push(ranked[humanRank] as PlayerView);
    this.leaders.replaceChildren(
      ...shown.map((player) => {
        const rank = ranked.indexOf(player) + 1;
        return h(
          "li",
          { class: player.id === HUMAN_ID ? "leader you" : "leader", value: rank },
          h("span", {
            class: "swatch",
            style: `background:${playerColor(player.id - 1).hex}`,
          }),
          h("span", { class: "leader-name" }, player.name),
          h("span", { class: "leader-land" }, formatPercent(player.tiles / this.ownableTiles)),
        );
      }),
    );
  }
}
