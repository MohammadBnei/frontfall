import type { Difficulty, ErrorCode, GameOptions, Teams } from "@frontfall/protocol";
import { MAP_GROUPS, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS } from "../game/solo-game.ts";
import { TEAM_CHOICES } from "./setup.ts";
import { applyTranslations, getLanguage, t, type MessageKey, type Params } from "../i18n/index.ts";
import type { LobbyState } from "../net/online.ts";
import { playerColor, teamColor } from "../palette.ts";
import { h, swatch } from "./dom.ts";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Maps an online game can be played on: those the server knows, from the published catalogue. */
export function onlineMaps(maps: readonly MapInfo[]): MapInfo[] {
  return maps.filter((map) => map.maxPlayers !== undefined);
}

/**
 * Most bots the server accepts on `map` with `players` humans in the game:
 * the seats left empty shrink to make room for them.
 */
export function botLimit(map: MapInfo, players: number): number {
  return Math.max(0, Math.min(MAX_BOTS, (map.maxPlayers ?? 0) - Math.max(1, players)));
}

export interface LobbyActions {
  /** Host of a private game: start with the players present. */
  onStart(): void;
  /** Host of a private game: new map, bots or difficulty. */
  onConfigure(options: GameOptions): void;
  onLeave(): void;
}

/** Why a game ended before or instead of starting, as the server says it. */
export type EndReason = "abandoned" | "timeout" | "expired" | "left";

/**
 * The room before an online game: who is in, the countdown of a public
 * game, the invitation link and the start button of a private one, and
 * what went wrong when something did. The connection lives elsewhere; this
 * only shows what it reports.
 */
export class LobbyScreen {
  readonly element: HTMLElement;
  private readonly title = h("h1", {
    class: "lobby-title",
    id: "lobby-title",
    "data-i18n": "online.title",
  });
  private readonly status = h("p", { class: "lobby-status", id: "lobby-status", role: "status" });
  private readonly players = h("ul", { class: "lobby-players", id: "lobby-players" });
  private readonly invite = h("input", {
    id: "invite-link",
    type: "text",
    readonly: true,
    "data-i18n-attr": "aria-label:online.invite",
  });
  private readonly copy = h("button", {
    type: "button",
    class: "secondary",
    id: "copy-invite",
    "data-i18n": "online.copy",
  });
  private readonly invitation = h(
    "div",
    { class: "lobby-invite", hidden: true },
    h("label", { for: "invite-link", "data-i18n": "online.invite" }),
    h("div", { class: "lobby-invite-row" }, this.invite, this.copy),
  );
  private readonly start = h("button", {
    type: "button",
    class: "primary",
    id: "lobby-start",
    hidden: true,
    "data-i18n": "online.start",
  });
  private readonly reload = h("button", {
    type: "button",
    class: "primary",
    id: "lobby-reload",
    hidden: true,
    "data-i18n": "online.reload",
  });
  private readonly mapSelect = h("select", { id: "lobby-map" });
  private readonly bots = h("input", {
    id: "lobby-bots",
    type: "range",
    min: "0",
    step: "1",
  });
  private readonly botsValue = h("output", { for: "lobby-bots", class: "range-value" });
  private readonly difficulty = h("select", { id: "lobby-difficulty" });
  private readonly nations = h("input", { id: "lobby-nations", type: "checkbox" });
  private readonly teams = h("select", { id: "lobby-teams" });
  private readonly settings = h(
    "div",
    { class: "lobby-settings", hidden: true },
    h("label", { for: "lobby-map", "data-i18n": "menu.map" }),
    this.mapSelect,
    h("label", { for: "lobby-bots", "data-i18n": "menu.bots" }),
    h("div", { class: "range" }, this.bots, this.botsValue),
    h("label", { for: "lobby-difficulty", "data-i18n": "menu.difficulty" }),
    this.difficulty,
    h("label", { for: "lobby-nations", "data-i18n": "menu.nations" }),
    h(
      "label",
      { class: "toggle", for: "lobby-nations" },
      this.nations,
      h("span", { "data-i18n": "menu.nationsHint" }),
    ),
    h("label", { for: "lobby-teams", "data-i18n": "menu.mode" }),
    this.teams,
  );
  private readonly summary = h("p", { class: "lobby-summary", id: "lobby-summary" });
  private shown: { key: MessageKey; params: Params } = { key: "status.connecting", params: {} };
  /** Countdown of a public game: when it starts, by this page's clock. */
  private startsAt: number | undefined;
  private lastLobby: LobbyState | undefined;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    actions: LobbyActions,
    private readonly maps: readonly MapInfo[],
  ) {
    const leave = h("button", {
      type: "button",
      class: "secondary",
      id: "lobby-leave",
      "data-i18n": "online.leave",
    });
    leave.addEventListener("click", () => {
      actions.onLeave();
    });
    this.start.addEventListener("click", () => {
      actions.onStart();
    });
    this.reload.addEventListener("click", () => {
      location.reload();
    });
    const configure = (): void => {
      const map = this.maps.find((candidate) => candidate.id === this.mapSelect.value);
      if (!map || !this.lastLobby) return;
      actions.onConfigure({
        map: map.id,
        bots: Math.min(Number(this.bots.value), botLimit(map, this.lastLobby.players.length)),
        difficulty: this.difficulty.value as Difficulty,
        nations: this.nations.checked,
        teams: Number(this.teams.value) as Teams,
      });
    };
    this.mapSelect.addEventListener("change", configure);
    this.difficulty.addEventListener("change", configure);
    this.nations.addEventListener("change", configure);
    this.teams.addEventListener("change", configure);
    this.bots.addEventListener("input", () => {
      this.botsValue.textContent = this.bots.value;
    });
    // Sent on release, not on every step of a drag.
    this.bots.addEventListener("change", configure);
    this.copy.addEventListener("click", () => {
      // Selected, the link can still be copied by hand where the clipboard is
      // out of reach, as on a page served over plain HTTP.
      this.invite.select();
      try {
        void navigator.clipboard.writeText(this.invite.value).then(
          () => {
            this.copy.textContent = t("online.copied");
          },
          () => undefined,
        );
      } catch {
        // No clipboard API at all.
      }
    });
    this.element = h(
      "main",
      { class: "menu lobby", id: "lobby" },
      h(
        "header",
        { class: "menu-header" },
        h("img", { class: "logo", src: "./logo-horizontal-on-dark.svg", alt: "Frontfall" }),
      ),
      h(
        "section",
        { class: "lobby-panel", "aria-labelledby": "lobby-title" },
        this.title,
        this.status,
        this.summary,
        this.settings,
        this.players,
        this.invitation,
        h("div", { class: "lobby-actions" }, this.start, this.reload, leave),
      ),
    );
    applyTranslations(this.element);
    this.show("status.connecting");
    this.timer = setInterval(() => {
      if (this.startsAt !== undefined && this.lastLobby) this.showLobbyStatus(this.lastLobby);
    }, 250);
  }

  /** The connection is opening, or dropped and retries in `retryInMs`. */
  connecting(retryInMs?: number): void {
    if (retryInMs === undefined) this.show("status.connecting");
    else this.show("status.disconnected", { seconds: Math.ceil(retryInMs / 1000) });
  }

  /** The server runs a newer version: this page cannot play until it reloads. */
  outdated(): void {
    this.lastLobby = undefined;
    this.startsAt = undefined;
    this.show("status.outdated");
    this.start.hidden = true;
    this.settings.hidden = true;
    this.reload.hidden = false;
  }

  /** The server refused this page's messages and closed the connection. */
  rejected(): void {
    this.stopped("online.rejected");
  }

  /** The game started on a map this page does not have. */
  unknownMap(): void {
    this.stopped("online.unknownMap");
  }

  lobby(lobby: LobbyState, inviteLink: string): void {
    this.lastLobby = lobby;
    this.startsAt = lobby.startsIn === null ? undefined : performance.now() + lobby.startsIn;
    const privateGame = lobby.visibility === "private";
    this.title.dataset.i18n = privateGame ? "online.private" : "online.public";
    this.title.textContent = t(this.title.dataset.i18n as MessageKey);
    this.players.replaceChildren(
      ...lobby.players.map((player, i) =>
        h(
          "li",
          { class: player.id === lobby.you ? "lobby-player you" : "lobby-player" },
          // In a team game, the shade of the team the seat is dealt into (R-MODE-02).
          swatch(
            lobby.teams === 0
              ? playerColor(player.id - 1).hex
              : teamColor((i % lobby.teams) + 1, Math.floor(i / lobby.teams)),
          ),
          h("span", {}, player.name),
          ...(player.id === lobby.host
            ? [h("span", { class: "lobby-host", "data-i18n": "online.host" }, t("online.host"))]
            : []),
        ),
      ),
    );
    this.invitation.hidden = !privateGame;
    if (privateGame) this.invite.value = inviteLink;
    this.start.hidden = !privateGame || lobby.host !== lobby.you;
    this.showSettings(lobby);
    this.showLobbyStatus(lobby);
  }

  /** The game ended before it started, or the player left it. */
  ended(reason: EndReason): void {
    this.stopped(`online.ended.${reason}`);
  }

  /** A request was refused: no such game, full, already started... */
  refused(code: ErrorCode, message: string): void {
    const key = `online.error.${code}` as MessageKey;
    const known = t(key) !== key;
    this.show(known ? key : "status.refused", known ? {} : { message });
  }

  /** Language changed: everything again in the new one. */
  refresh(): void {
    applyTranslations(this.element);
    this.show(this.shown.key, this.shown.params);
    if (this.lastLobby) this.lobby(this.lastLobby, this.invite.value);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.element.remove();
  }

  /** Nothing more will happen here but leaving: says why. */
  private stopped(key: MessageKey): void {
    this.lastLobby = undefined;
    this.startsAt = undefined;
    this.start.hidden = true;
    this.settings.hidden = true;
    this.show(key);
  }

  /** The host of a private game changes the settings; everyone else reads them. */
  private showSettings(lobby: LobbyState): void {
    const map = this.maps.find((candidate) => candidate.id === lobby.map);
    const mapName = map?.name?.[getLanguage()] ?? lobby.map;
    const summary = t(lobby.nations ? "online.summaryNations" : "online.summary", {
      map: mapName,
      bots: lobby.bots,
      difficulty: t(`difficulty.${lobby.difficulty}`),
    });
    this.summary.textContent =
      lobby.teams === 0
        ? summary
        : t("online.summaryTeams", {
            summary,
            mode: t(`mode.${String(lobby.teams)}` as MessageKey),
          });
    const editable = lobby.visibility === "private" && lobby.host === lobby.you && map;
    this.settings.hidden = !editable;
    this.summary.hidden = Boolean(editable);
    if (!editable) return;
    // Only maps that seat every player already in.
    const fitting = this.maps.filter(
      (candidate) =>
        (candidate.maxPlayers ?? 0) >= lobby.players.length || candidate.id === lobby.map,
    );
    this.mapSelect.replaceChildren(
      ...MAP_GROUPS.filter((group) => fitting.some((candidate) => candidate.group === group)).map(
        (group) =>
          h(
            "optgroup",
            { label: t(`menu.maps.${group}`) },
            ...fitting
              .filter((candidate) => candidate.group === group)
              .map((candidate) =>
                h(
                  "option",
                  { value: candidate.id },
                  candidate.name?.[getLanguage()] ?? candidate.id,
                ),
              ),
          ),
      ),
    );
    this.mapSelect.value = lobby.map;
    this.difficulty.replaceChildren(
      ...DIFFICULTIES.map((level) => h("option", { value: level }, t(`difficulty.${level}`))),
    );
    this.difficulty.value = lobby.difficulty;
    this.nations.checked = lobby.nations;
    this.teams.replaceChildren(
      ...TEAM_CHOICES.map((teams) =>
        h("option", { value: teams }, t(`mode.${String(teams)}` as MessageKey)),
      ),
    );
    this.teams.value = String(lobby.teams);
    this.bots.max = String(botLimit(map, lobby.players.length));
    this.bots.value = String(lobby.bots);
    this.botsValue.textContent = String(lobby.bots);
  }

  private showLobbyStatus(lobby: LobbyState): void {
    const count = { players: lobby.players.length, capacity: lobby.capacity };
    if (this.startsAt === undefined) {
      this.show(lobby.visibility === "private" ? "online.waitingHost" : "status.waiting", count);
    } else {
      const seconds = Math.max(0, Math.ceil((this.startsAt - performance.now()) / 1000));
      this.show("status.starting", { ...count, seconds });
    }
  }

  private show(key: MessageKey, params: Params = {}): void {
    this.shown = { key, params };
    this.status.textContent = t(key, params);
  }
}
