import { CATALOGUE, type AchievementId } from "./catalog.ts";

const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

/** Plate colours, top to bottom, by level: grey for one still to earn, then bronze, silver and gold. */
const PLATES = [
  { top: "#3a4d5f", bottom: "#1b2a38", shadow: "#0a131c", glyph: "#5c7389" },
  { top: "#e0a273", bottom: "#9a5a2c", shadow: "#5e3515", glyph: "#fff" },
  { top: "#e3ecf4", bottom: "#8097ad", shadow: "#475a6b", glyph: "#fff" },
  { top: "#ffc766", bottom: "#c4701c", shadow: "#7a4310", glyph: "#fff" },
] as const;

/** Tier names, by level: locked, bronze, silver, gold. */
const NAMES = ["locked", "bronze", "silver", "gold"] as const;

/**
 * An achievement's badge: the rounded plate of the art direction (docs/art-direction.md)
 * with the achievement's own glyph. Stroke-free and readable at 16 px; it carries no
 * text, the name goes next to it.
 */
export function badge(id: AchievementId, level: number): SVGSVGElement {
  const entry = CATALOGUE.find((candidate) => candidate.id === id);
  const step = Math.max(0, Math.min(3, level));
  const colors = PLATES[step] ?? PLATES[0];
  const name = NAMES[step] ?? "locked";
  const gradient = `badge-${name}`;
  const root = svg("svg", {
    viewBox: "0 0 24 24",
    class: `badge ${name}`,
    "aria-hidden": "true",
    focusable: "false",
  });
  root.append(
    svg(
      "defs",
      {},
      svg(
        "linearGradient",
        { id: gradient, x1: "0", y1: "0", x2: "0", y2: "1" },
        svg("stop", { offset: "0", "stop-color": colors.top }),
        svg("stop", { offset: "1", "stop-color": colors.bottom }),
      ),
    ),
    svg("rect", {
      x: "1.5",
      y: "1",
      width: "21",
      height: "21",
      rx: "6",
      fill: colors.shadow,
      transform: "translate(0 1.4)",
    }),
    svg("rect", {
      x: "1.5",
      y: "1",
      width: "21",
      height: "21",
      rx: "6",
      fill: `url(#${gradient})`,
    }),
    svg("rect", {
      x: "2.6",
      y: "2",
      width: "18.8",
      height: "9",
      rx: "4.5",
      fill: "#fff",
      "fill-opacity": ".14",
    }),
    svg(
      "g",
      { transform: "translate(4.1 3.6) scale(.66)" },
      svg("path", { d: entry?.glyph ?? "", fill: colors.glyph, "fill-rule": "evenodd" }),
    ),
  );
  return root;
}
