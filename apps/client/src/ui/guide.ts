import "./guide.css";
import { applyTranslations, type MessageKey } from "../i18n/index.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** The steps of a first game, in order; each one waits for the player to do it. */
export const STEPS = [
  "start",
  "expand",
  "attack",
  "fronts",
  "build",
  "sail",
  "defend",
  "players",
  "done",
] as const;
export type Step = (typeof STEPS)[number];

/** What the guide watches in the game. */
export interface GuideState {
  phase: "spawn" | "play";
  /** The player's land, in tiles. */
  tiles: number;
  /** The player's land when the attacks opened; 0 before. */
  tilesAtPlay: number;
  /** Cities the player owns, built or being built. */
  cities: number;
  /** Forts the player owns, built or being built. */
  forts: number;
  /** Ports the player owns, built or being built. */
  ports: number;
  /** Whether a ship of the player's has sailed since the guide began. */
  sailed: boolean;
  /** Whether a front has given way since the guide began. */
  collapsed: boolean;
  /** Whether the menu of another player is open. */
  playerMenu: boolean;
}

/** What the steps quote: the price of the buildings they ask for. */
export interface GuideCosts {
  city: number;
  port: number;
}

/** The step the player is on once they have done what `step` asks, or `step` itself. */
export function advance(step: Step, state: GuideState): Step {
  const done: Record<Step, boolean> = {
    start: state.tiles > 0,
    expand: state.phase === "play" && state.tiles > state.tilesAtPlay,
    // Sending troops is the one thing here the guide cannot see; it moves on once the player builds.
    attack: state.cities > 0 || state.forts > 0,
    // A front giving way cannot be asked for; the step waits for Next, one, or a building.
    fronts: state.collapsed || state.cities > 0 || state.forts > 0,
    build: state.cities > 0,
    // Not every map has a coast to sail from: Next, a ship, a port or a fort moves on.
    sail: state.sailed || state.ports > 0 || state.forts > 0,
    defend: state.forts > 0,
    players: state.playerMenu,
    done: false,
  };
  let index = STEPS.indexOf(step);
  // A player who already did a later step is not asked for it: it is skipped too.
  while (done[STEPS[index] as Step] && index < STEPS.length - 1) index++;
  return STEPS[index] as Step;
}

const TEXTS: Readonly<Record<Step, { mouse: MessageKey; touch: MessageKey }>> = {
  start: { mouse: "guide.start", touch: "guide.startTouch" },
  expand: { mouse: "guide.expand", touch: "guide.expandTouch" },
  attack: { mouse: "guide.attack", touch: "guide.attackTouch" },
  fronts: { mouse: "guide.fronts", touch: "guide.fronts" },
  build: { mouse: "guide.build", touch: "guide.buildTouch" },
  sail: { mouse: "guide.sail", touch: "guide.sailTouch" },
  defend: { mouse: "guide.defend", touch: "guide.defendTouch" },
  players: { mouse: "guide.players", touch: "guide.playersTouch" },
  done: { mouse: "guide.done", touch: "guide.doneTouch" },
};

/**
 * First steps for a new player: a small card, out of the way, with one thing
 * to do at a time. It never blocks the game; each step moves on when the
 * player does it, or with Next, and Hide puts the guide away for good.
 */
export class Guide {
  readonly element: HTMLElement;
  private step: Step = "start";
  private readonly title = h("h2", { class: "guide-title", id: "guide-title" });
  private readonly text = h("p", { class: "guide-text", id: "guide-text" });
  private readonly next = h("button", { type: "button", class: "secondary", id: "guide-next" });
  private readonly hide = h("button", {
    type: "button",
    class: "guide-hide",
    id: "guide-hide",
    "data-i18n": "guide.hide",
  });
  private costs: GuideCosts = { city: 0, port: 0 };

  /** `onComplete`: the player is through the guide or put it away, so it is not shown again. */
  constructor(
    private readonly touch: boolean,
    private readonly onComplete: () => void,
  ) {
    this.next.addEventListener("click", () => {
      if (this.step === "done") {
        this.finish();
        return;
      }
      this.show(STEPS[STEPS.indexOf(this.step) + 1] as Step);
    });
    this.hide.addEventListener("click", () => {
      this.finish();
    });
    this.element = h(
      "section",
      { class: "panel guide", id: "guide", "aria-labelledby": "guide-title" },
      this.title,
      // Read out when the step changes, without taking the focus from the map.
      h("div", { "aria-live": "polite" }, this.text),
      h("div", { class: "guide-actions" }, this.hide, this.next),
    );
    this.show("start");
  }

  /** Follows the game: moves on when the player did what the step asks. */
  update(state: GuideState, costs: GuideCosts): void {
    const step = advance(this.step, state);
    const costChanged =
      (step === "build" && costs.city !== this.costs.city) ||
      (step === "sail" && costs.port !== this.costs.port);
    this.costs = costs;
    if (step !== this.step || costChanged) this.show(step);
  }

  /** Language changed: the texts again. */
  refresh(): void {
    this.show(this.step);
  }

  private show(step: Step): void {
    this.step = step;
    const number = STEPS.indexOf(step) + 1;
    this.title.dataset.i18n = "guide.title";
    this.title.dataset.i18nParams = JSON.stringify({
      step: Math.min(number, STEPS.length - 1),
      count: STEPS.length - 1,
    });
    this.text.dataset.i18n = TEXTS[step][this.touch ? "touch" : "mouse"];
    this.text.dataset.i18nParams = JSON.stringify({
      cost: formatCount(step === "sail" ? this.costs.port : this.costs.city),
    });
    this.next.dataset.i18n = step === "done" ? "guide.close" : "guide.next";
    this.hide.hidden = step === "done";
    this.element.dataset.step = step;
    applyTranslations(this.element);
    if (step === "done") this.onComplete();
  }

  private finish(): void {
    this.element.remove();
    this.onComplete();
  }

  /** Whether the guide is still on screen. */
  get shown(): boolean {
    return this.element.isConnected;
  }
}
