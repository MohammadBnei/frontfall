import type { LabelAnchor } from "../game/label-anchors.ts";
import type { PlayerView } from "../game/solo-game.ts";
import type { Camera } from "../render/camera.ts";
import { h } from "./dom.ts";
import { formatCount } from "./format.ts";

/**
 * Font sizes a name can take, in CSS pixels. Few steps, so neighbours of
 * about the same size get the same size rather than a pixel or two apart.
 */
const FONT_SIZES = [10, 12, 15, 19, 24, 30] as const;
/** Width of an average character of the label font, in ems. */
const CHAR_EM = 0.6;
/** Labels stay this far from the edges of the screen. */
const MARGIN = 4;
/** A name may run this much wider than the land around its tile before it shrinks. */
const OVERFLOW = 1.15;
/** Line height of name and troops together, in ems. */
const LINES_EM = 2.1;

/** A rectangle on the screen, in CSS pixels; a DOMRect is one. */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

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
  private obstacles: readonly Box[] = [];

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

  /** Parts of the screen labels must leave clear, such as the panels of the HUD. */
  avoid(obstacles: readonly Box[]): void {
    this.obstacles = obstacles;
  }

  /** Moves the labels to follow the camera; call every frame. */
  place(camera: Camera, scale: number): void {
    const shown = new Set<number>();
    const { viewportWidth, viewportHeight } = camera;
    // Largest lands first: where two names would overlap, the smaller one gives way.
    const taken: Box[] = [...this.obstacles];
    const anchors = [...this.anchors].sort((a, b) => b.depth - a.depth);
    for (const anchor of anchors) {
      const label = this.labels.get(anchor.player);
      if (!label) continue;
      // The size follows the depth of the land alone, so it does not jump with the name.
      const across = 2 * anchor.depth * scale;
      const room = across * OVERFLOW;
      const length = label.name.length * CHAR_EM;
      const size = FONT_SIZES.findLast(
        (step) => step * LINES_EM <= across && step * length <= room,
      );
      if (size === undefined) continue;
      const { x, y } = camera.tileToScreen(anchor.tile);
      const halfWidth = (length * size) / 2;
      if (x < -halfWidth || x > viewportWidth + halfWidth || y < 0 || y > viewportHeight) continue;
      // Half off the screen, a name slides in rather than being cut.
      const left = Math.min(viewportWidth - halfWidth - MARGIN, Math.max(halfWidth + MARGIN, x));
      const halfHeight = (size * LINES_EM) / 2;
      const box = {
        left: left - halfWidth,
        right: left + halfWidth,
        top: y - halfHeight,
        bottom: y + halfHeight,
      };
      if (taken.some((other) => overlaps(box, other))) continue;
      taken.push(box);
      label.root.style.transform = `translate(${left.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      label.root.style.fontSize = `${String(size)}px`;
      shown.add(anchor.player);
    }
    for (const [id, label] of this.labels) label.root.hidden = !shown.has(id);
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
