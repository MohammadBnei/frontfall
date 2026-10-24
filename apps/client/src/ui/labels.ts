import type { LabelAnchor } from "../game/label-anchors.ts";
import type { PlayerView } from "../game/solo-game.ts";
import type { Camera } from "../render/camera.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/** Smallest name worth drawing, in CSS pixels. */
const MIN_FONT = 9;
const MAX_FONT = 30;
/** Width of an average character of the label font, in ems. */
const CHAR_EM = 0.6;
/** Labels stay this far from the edges of the screen. */
const MARGIN = 4;

interface Label {
  readonly root: HTMLElement;
  readonly troops: HTMLElement;
  readonly name: string;
}

/**
 * Player names and troops drawn over their land, on its deepest tile, as
 * large as the land around that tile allows on screen. The simulation finds
 * the tiles (game/label-anchors.ts); this only places and sizes them.
 */
export class PlayerLabels {
  readonly element = h("div", { class: "labels", "aria-hidden": "true" });
  private readonly labels = new Map<number, Label>();
  private anchors: readonly LabelAnchor[] = [];

  update(players: readonly PlayerView[], anchors: readonly LabelAnchor[] | undefined): void {
    if (anchors) this.anchors = anchors;
    for (const player of players) {
      let label = this.labels.get(player.id);
      if (!label) {
        const troops = h("span", { class: "label-troops" });
        const root = h(
          "div",
          { class: "label" },
          h("span", { class: "label-name" }, player.name),
          troops,
        );
        this.element.append(root);
        label = { root, troops, name: player.name };
        this.labels.set(player.id, label);
      }
      label.troops.textContent = formatCount(player.troops);
    }
  }

  /** Moves the labels to follow the camera; call every frame. */
  place(camera: Camera, scale: number): void {
    const shown = new Set<number>();
    const { viewportWidth, viewportHeight } = camera;
    for (const anchor of this.anchors) {
      const label = this.labels.get(anchor.player);
      if (!label) continue;
      // The name spans at most the width of land around its tile, and fits its height.
      const across = 2 * anchor.depth * scale;
      const size = Math.min(MAX_FONT, across / (label.name.length * CHAR_EM), across / 2.4);
      if (size < MIN_FONT) continue;
      const { x, y } = camera.tileToScreen(anchor.tile);
      const halfWidth = (label.name.length * CHAR_EM * size) / 2;
      if (x < -halfWidth || x > viewportWidth + halfWidth || y < 0 || y > viewportHeight) continue;
      // Half off the screen, a name slides in rather than being cut.
      const left = Math.min(viewportWidth - halfWidth - MARGIN, Math.max(halfWidth + MARGIN, x));
      label.root.style.transform = `translate(${left.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      label.root.style.fontSize = `${size.toFixed(1)}px`;
      shown.add(anchor.player);
    }
    for (const [id, label] of this.labels) label.root.hidden = !shown.has(id);
  }
}
