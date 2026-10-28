import { GAME_SPEEDS } from "@frontfall/protocol";
import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";

/**
 * The button that sets how fast a solo game runs (R-MODE-07): each press, or
 * T, goes to the next pace, ×1, ×2, ×4 and back to ×1. Only the cadence of
 * the ticks changes, so a record of the game replays the same at any pace.
 */
export class SpeedControl {
  private readonly label = h("span", { class: "speed-value" });
  readonly element = h(
    "button",
    { type: "button", class: "icon-button speed-button", id: "speed" },
    this.label,
    h("kbd", { class: "tool-key", "aria-hidden": "true" }, "T"),
  );

  constructor(
    private speed: number,
    private readonly onSpeed: (speed: number) => void,
  ) {
    this.element.addEventListener("click", () => {
      this.next();
    });
    this.show();
  }

  /** The next pace, after the one running; a test's own pace goes back to ×1. */
  next(): void {
    this.speed = GAME_SPEEDS.find((speed) => speed > this.speed) ?? 1;
    this.onSpeed(this.speed);
    this.show();
  }

  /** Again in the language just picked. */
  show(): void {
    const speed = String(this.speed);
    this.label.textContent = t("replay.speed", { speed });
    this.element.setAttribute("aria-label", t("hud.speed", { speed }));
    this.element.title = t("hud.speedKey", { speed });
  }
}
