import type { GameUpdate } from "../../game/solo-game.ts";
// The guide loads when first shown, out of the first download.
import type { Guide } from "../guide.ts";
import { setGuideDone } from "../guide-state.ts";
import { safeStorage } from "../setup.ts";

/** The first steps of a first solo game, shown over the HUD while they last. */
export class GuideHost {
  private guide: Guide | undefined;
  /** The player's land when the attacks opened, for the guide. */
  private tilesAtPlay: number | undefined;
  /** Seen since the guide began: a ship of the player's at sea, a front giving way. */
  private sailed = false;
  private collapsed = false;

  constructor(
    /** Where the guide goes: the HUD. */
    private readonly parent: HTMLElement,
    /** A finger rather than a mouse: the guide shows gestures instead of keys. */
    private readonly coarsePointer: MediaQueryList,
    /** The game as it stands, to start the guide at its step. */
    private readonly latest: () => GameUpdate | undefined,
    /** Whether the player menu is open, a step of the guide. */
    private readonly playerMenu: () => boolean,
  ) {}

  /** Shows the guide from its first step, over the one showing if any. */
  start(): void {
    void import("../guide.ts").then(({ Guide }) => {
      this.guide?.element.remove();
      this.guide = new Guide(this.coarsePointer.matches, () => {
        setGuideDone(safeStorage(), true);
      });
      this.parent.append(this.guide.element);
      const latest = this.latest();
      const human = latest?.players.find((player) => player.id === latest.you);
      if (latest) this.follow(latest, human?.tiles ?? 0);
    });
  }

  /** Moves the guide on with the game; `tiles` is the player's land. */
  follow(update: GameUpdate, tiles: number): void {
    const guide = this.guide;
    if (!guide) return;
    if (!guide.shown) {
      this.guide = undefined;
      return;
    }
    if (update.phase === "play") this.tilesAtPlay ??= tiles;
    if (update.boats.some((boat) => boat.player === update.you)) this.sailed = true;
    if (update.events.some((event) => event.type === "collapsed")) this.collapsed = true;
    guide.update(
      {
        phase: update.phase,
        tiles,
        tilesAtPlay: this.tilesAtPlay ?? 0,
        cities: update.structures.filter((s) => s.player === update.you && s.type === "city")
          .length,
        forts: update.structures.filter((s) => s.player === update.you && s.type === "fort").length,
        ports: update.structures.filter((s) => s.player === update.you && s.type === "port").length,
        sailed: this.sailed,
        collapsed: this.collapsed,
        playerMenu: this.playerMenu(),
      },
      { city: update.build.cityCost, port: update.build.portCost },
    );
  }

  refresh(): void {
    this.guide?.refresh();
  }
}
