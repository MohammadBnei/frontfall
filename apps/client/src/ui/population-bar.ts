import { t } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** The band is where troops grow at least this share of their fastest. */
const BAND_SHARE = 0.85;

/**
 * Growth of an army filling `fill` of its cap, against the fastest at an
 * empty one (R-ECO-02, the engine's `troopGrowth` without its rounding).
 */
function growthAt(fill: number, floor: number): number {
  return (1 - fill) * (floor + (1 - floor) * fill);
}

/** The fills, from 0 to 1, where an army grows near its fastest. */
export function growthBand(floorPercent: number): { from: number; to: number } {
  const floor = Math.min(1, Math.max(0, floorPercent / 100));
  const steps = 200;
  const values = Array.from({ length: steps + 1 }, (_, i) => growthAt(i / steps, floor));
  const best = Math.max(...values);
  const inside = values.flatMap((value, i) => (value >= best * BAND_SHARE ? [i / steps] : []));
  return { from: inside[0] ?? 0, to: inside.at(-1) ?? 0 };
}

/**
 * How the player's troops grow: their army against its cap, the band where
 * it grows fastest, and the troops it gains each second. A press explains it.
 */
export class PopulationBar {
  readonly element: HTMLButtonElement;
  private readonly fill = h("span", { class: "pop-fill" });
  private readonly band = h("span", { class: "pop-band" });
  private readonly rate = h("span", { class: "pop-rate" });
  private span = { from: 0, to: 0 };

  constructor(onExplain: (text: string) => void) {
    this.element = h(
      "button",
      { type: "button", class: "pop-bar", "aria-describedby": "build-tip" },
      h("span", { class: "pop-track", "aria-hidden": "true" }, this.fill, this.band),
      h("span", { class: "pop-figures" }, this.rate),
    );
    // A finger has no tooltip: a press shows the figures, which a phone hides, and how growth works.
    this.element.addEventListener("click", () => {
      onExplain(`${this.element.getAttribute("aria-label") ?? ""} ${t("hud.growthHelp")}`);
    });
    this.setFloor(100);
  }

  /** B-GROWTH-FLOOR of the game: where the band lies. */
  setFloor(floorPercent: number): void {
    this.span = growthBand(floorPercent);
    const { from, to } = this.span;
    this.band.style.left = `${String(from * 100)}%`;
    this.band.style.width = `${String((to - from) * 100)}%`;
  }

  update(troops: number, cap: number, growth: number): void {
    const fill = cap > 0 ? Math.min(1, troops / cap) : 0;
    this.fill.style.width = `${String(fill * 100)}%`;
    const { from, to } = this.span;
    this.element.classList.toggle("in-band", growth > 0 && fill >= from && fill <= to);
    this.element.classList.toggle("full", growth === 0 && fill >= 1);
    const count = formatCount(growth);
    const rate = t("hud.growthRate", { troops: count });
    this.rate.textContent = rate;
    // The name starts with the figures shown, so a voice command can name the button by them.
    this.element.setAttribute("aria-label", `${rate}. ${t("hud.growthNow", { troops: count })}`);
    this.element.title = t("hud.growthHelp");
  }
}
