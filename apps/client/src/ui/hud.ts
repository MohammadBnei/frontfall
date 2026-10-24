import type { GameRules } from "../game/messages.ts";
import type { GameUpdate, PlayerView } from "../game/solo-game.ts";
import { applyTranslations, t } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { betaBadge } from "./beta.ts";
import { h, present, swatch } from "./dom.ts";
import { formatCount, formatDuration, formatPercent } from "./format.ts";

/** B-ATTACK-RATIO-MIN and the interface default of R-ATTACK-02, in percent. */
export const MIN_RATIO = 5;
export const DEFAULT_RATIO = 30;
/** The HUD is redrawn at most this often; the map keeps its own pace. */
const REFRESH_MS = 250;
const LEADERBOARD_SIZE = 10;

export interface HudActions {
  onPause(): void;
  onHelp(): void;
  onMenu(): void;
  /** Calls back one of the player's attacks, by id. */
  onRetreat(attack: number): void;
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
  private readonly goal = h("p", { class: "goal-text" });
  private readonly goalLeader = h("span", { class: "goal-fill goal-leader" });
  private readonly goalYou = h("span", { class: "goal-fill goal-you" });
  private readonly clock = h("p", { class: "goal-clock" });
  private readonly attackList = h("ul", { class: "attack-list" });
  private readonly attackPanel = h(
    "section",
    { class: "panel attacks", "data-i18n-attr": "aria-label:hud.attacks", hidden: true },
    this.attackList,
  );
  /** One row per attack under way, kept across renders so a button under the pointer stays put. */
  private readonly attackRows = new Map<number, { row: HTMLElement; text: HTMLElement }>();
  private readonly onRetreat: (attack: number) => void;
  private rules: GameRules = {
    ownableTiles: 1,
    ticksPerSecond: 10,
    winSharePercent: 100,
    maxDurationTicks: Infinity,
    retreatPenaltyPercent: 0,
  };

  /** `pausable`: false online, where the game runs for everyone. */
  constructor(actions: HudActions, { pausable = true }: { pausable?: boolean } = {}) {
    this.onRetreat = (attack) => {
      actions.onRetreat(attack);
    };
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
    const menu = h("button", {
      type: "button",
      class: "icon-button icon-menu",
      id: "leave",
      "data-i18n-attr": "aria-label:hud.menu;title:hud.menu",
    });
    menu.addEventListener("click", () => {
      actions.onMenu();
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
        h(
          "div",
          { class: "goal" },
          this.goal,
          // Both bars run from 0 to the winning share; the leader's is drawn under yours.
          h("div", { class: "goal-bar", "aria-hidden": "true" }, this.goalLeader, this.goalYou),
          this.clock,
        ),
      ),
      h(
        "div",
        { class: "panel ratio" },
        h("label", { for: "attack-ratio", "data-i18n": "hud.ratio" }),
        this.ratioInput,
        this.ratioValue,
      ),
      this.attackPanel,
      h("div", { class: "toolbar" }, help, ...(pausable ? [pause] : []), menu),
      ...present(betaBadge("beta-hud")),
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

  setRules(rules: GameRules): void {
    this.rules = { ...rules, ownableTiles: Math.max(1, rules.ownableTiles) };
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
    const human = update.players.find((player) => player.id === update.you);
    if (human) {
      this.troops.textContent = formatCount(human.troops);
      this.troopsCap.textContent = t("hud.cap", { cap: formatCount(human.cap) });
      this.gold.textContent = formatCount(human.gold);
      this.land.textContent = this.share(human.tiles);
    }
    this.banner.textContent = this.bannerText(update, human);
    this.renderLeaders(update.players, update.you);
    this.renderGoal(update, human);
    this.renderAttacks(update);
  }

  /** The player's attacks under way, each with a button to call it back. */
  private renderAttacks(update: GameUpdate): void {
    const names = new Map(update.players.map((player) => [player.id, player.name]));
    const current = new Set<number>();
    for (const attack of update.attacks) {
      current.add(attack.id);
      let entry = this.attackRows.get(attack.id);
      if (!entry) {
        const text = h("span", { class: "attack-text" });
        const retreat = h("button", { type: "button", class: "attack-retreat" }, t("hud.retreat"));
        retreat.title = t("hud.retreatHint", {
          penalty: formatPercent(this.rules.retreatPenaltyPercent / 100),
        });
        retreat.addEventListener("click", () => {
          this.onRetreat(attack.id);
        });
        entry = { row: h("li", { class: "attack" }, text, retreat), text };
        this.attackRows.set(attack.id, entry);
        this.attackList.append(entry.row);
      }
      const target =
        attack.target === 0 ? t("hud.unclaimed") : (names.get(attack.target) ?? t("hud.unclaimed"));
      entry.text.textContent = t("hud.attackOn", { target, troops: formatCount(attack.troops) });
    }
    for (const [id, entry] of this.attackRows) {
      if (current.has(id)) continue;
      entry.row.remove();
      this.attackRows.delete(id);
    }
    this.attackPanel.hidden = current.size === 0;
  }

  /** Share of the land; a start on the World is a few hundredths of a percent. */
  private share(tiles: number): string {
    const share = tiles / this.rules.ownableTiles;
    return share > 0 && share < 0.001
      ? t("hud.under", { value: formatPercent(0.001) })
      : formatPercent(share);
  }

  /** How far the leader and the player are from winning, and the time left. */
  private renderGoal(update: GameUpdate, human: PlayerView | undefined): void {
    const { ownableTiles, ticksPerSecond, winSharePercent, maxDurationTicks } = this.rules;
    const win = winSharePercent / 100;
    this.goal.textContent = t("hud.goal", { share: formatPercent(win) });
    // R-WIN-02: among the players still in the game.
    const leader = Math.max(0, ...update.players.filter((p) => p.alive).map((p) => p.tiles));
    const width = (tiles: number): string =>
      `${String(Math.min(100, (tiles / ownableTiles / win) * 100))}%`;
    this.goalLeader.style.width = width(leader);
    this.goalYou.style.width = width(human?.tiles ?? 0);
    this.clock.textContent = Number.isFinite(maxDurationTicks)
      ? t("hud.clock", {
          elapsed: formatDuration(update.tick / ticksPerSecond),
          limit: formatDuration(maxDurationTicks / ticksPerSecond),
        })
      : formatDuration(update.tick / ticksPerSecond);
  }

  private bannerText(update: GameUpdate, human: PlayerView | undefined): string {
    const seconds = Math.ceil(update.spawnTicksLeft / this.rules.ticksPerSecond);
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

  private renderLeaders(players: readonly PlayerView[], you: number): void {
    const ranked = players
      .filter((player) => player.alive)
      .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
    const shown = ranked.slice(0, LEADERBOARD_SIZE);
    const humanRank = ranked.findIndex((player) => player.id === you);
    if (humanRank >= LEADERBOARD_SIZE) shown.push(ranked[humanRank] as PlayerView);
    this.leaders.replaceChildren(
      ...shown.map((player) => {
        const rank = ranked.indexOf(player) + 1;
        return h(
          "li",
          { class: player.id === you ? "leader you" : "leader", value: rank },
          swatch(playerColor(player.id - 1).hex),
          h("span", { class: "leader-name" }, player.name),
          h("span", { class: "leader-land" }, this.share(player.tiles)),
        );
      }),
    );
  }
}
