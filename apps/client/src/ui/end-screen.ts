import type { GameUpdate } from "../game/solo-game.ts";
import { applyTranslations, t, type MessageKey } from "../i18n/index.ts";
import type { GameTracker } from "../usage.ts";
import { CATALOGUE, badgeLevel } from "../achievements/catalog.ts";
import type { Gain } from "../achievements/store.ts";
import { badge } from "../achievements/badge.ts";
import { h } from "./dom.ts";
import { feedbackBlock } from "./feedback.ts";
import { formatDuration, formatPercent } from "./format.ts";

export interface EndScreenActions {
  onNewGame(): void;
  onMenu(): void;
  onWatch(): void;
  /** Saves a record of the game to watch again. */
  onDownload(): void;
}

export interface GameSummary {
  update: GameUpdate;
  ticksPerSecond: number;
  ownableTiles: number;
  /** Most land the human held at any time, in tiles. */
  peakTiles: number;
  /** Achievements this game earned for the first time. */
  achievements: readonly Gain[];
  /** Whether the game can be saved as a replay. */
  canRecord: boolean;
  /** Team of each player by id, in a team game. */
  teams: readonly number[];
  /** The map and the device, for a bug report. */
  details: string;
}

/** Who won, how long it took, how far the player got, and a way to play again. */
export function endScreen(
  summary: GameSummary,
  tracker: GameTracker | undefined,
  actions: EndScreenActions,
): HTMLElement {
  const { update } = summary;
  const winner = update.players.find((player) => player.id === update.winner);
  const team = update.winningTeam;
  const won =
    team === undefined ? update.winner === update.you : summary.teams[update.you] === team;
  const seconds = update.tick / summary.ticksPerSecond;

  const button = (key: MessageKey, onClick: () => void, primary = false): HTMLButtonElement => {
    const element = h("button", {
      type: "button",
      class: primary ? "primary" : "secondary",
      "data-i18n": key,
    });
    element.addEventListener("click", onClick);
    return element;
  };

  const row = (key: MessageKey, value: string): HTMLElement[] => [
    h("dt", { "data-i18n": key }),
    h("dd", {}, value),
  ];

  const dialog = h(
    "section",
    {
      class: `end-screen ${won ? "won" : "lost"}`,
      id: "end-screen",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "end-title",
    },
    h("h1", { id: "end-title", "data-i18n": won ? "end.victory" : "end.defeat" }),
    h(
      "p",
      { class: "end-winner" },
      team === undefined
        ? t("end.winner", { name: winner?.name ?? "" })
        : t("end.teamWinner", { team, name: winner?.name ?? "" }),
    ),
    h(
      "dl",
      { class: "end-stats" },
      ...row("end.duration", formatDuration(seconds)),
      ...row("end.peak", formatPercent(summary.peakTiles / Math.max(1, summary.ownableTiles))),
    ),
    ...(summary.achievements.length > 0 ? [newAchievements(summary.achievements)] : []),
    // A thumbs up or down, once per game played (not for a replay).
    ...(tracker ? [feedbackBlock(tracker, summary.details)] : []),
    h(
      "div",
      { class: "end-actions" },
      button(
        "end.newGame",
        () => {
          actions.onNewGame();
        },
        true,
      ),
      button("end.watch", () => {
        actions.onWatch();
      }),
      ...(summary.canRecord
        ? [
            button("end.download", () => {
              actions.onDownload();
            }),
          ]
        : []),
      button("end.menu", () => {
        actions.onMenu();
      }),
    ),
  );
  applyTranslations(dialog);
  return h("div", { class: "overlay" }, dialog);
}

/** The achievements this game unlocked, each with its badge and, for a tiered one, the tier. */
function newAchievements(gains: readonly Gain[]): HTMLElement {
  return h(
    "section",
    { class: "end-achievements", "aria-labelledby": "end-achievements-title" },
    h("h2", { id: "end-achievements-title", "data-i18n": "end.achievements" }),
    h(
      "ul",
      {},
      ...gains.map(({ id, level }) => {
        const achievement = CATALOGUE.find((candidate) => candidate.id === id);
        return h(
          "li",
          {},
          badge(id, achievement ? badgeLevel(achievement, level) : 3),
          h(
            "span",
            {},
            h("strong", { "data-i18n": `achievement.${id}.name` as MessageKey }),
            achievement?.tiers
              ? h("em", { "data-i18n": `achievements.tier.${String(level)}` as MessageKey })
              : h("small", { "data-i18n": `achievement.${id}.text` as MessageKey }),
          ),
        );
      }),
    ),
  );
}
