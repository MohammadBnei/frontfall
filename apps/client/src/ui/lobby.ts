import type { ErrorCode } from "@frontfall/protocol";
import { applyTranslations, t, type MessageKey, type Params } from "../i18n/index.ts";
import type { LobbyState } from "../net/online.ts";
import { playerColor } from "../palette.ts";
import { h } from "./dom.ts";

export interface LobbyActions {
  /** Host of a private game: start with the players present. */
  onStart(): void;
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
  private shown: { key: MessageKey; params: Params } = { key: "status.connecting", params: {} };
  /** Countdown of a public game: when it starts, by this page's clock. */
  private startsAt: number | undefined;
  private lastLobby: LobbyState | undefined;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(actions: LobbyActions) {
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
      ...lobby.players.map((player) =>
        h(
          "li",
          { class: player.id === lobby.you ? "lobby-player you" : "lobby-player" },
          h("span", {
            class: "swatch",
            style: `background:${playerColor(player.id - 1).hex}`,
          }),
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
    this.show(key);
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
