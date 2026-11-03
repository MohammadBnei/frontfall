/**
 * The pictograms of the build bar and the help (docs/art-direction.md, "Interface"): twelve white
 * silhouettes on a dark translucent disc, ringed in the owner's colour with a light halo, like
 * markers on a tactical map. `--own` is the player's colour, set on the game screen. The shaded
 * details and the flame are painted in the glyphs themselves, as a `<use>` does not see the
 * stylesheet's selectors. The other icons stay in the one-colour sprite of `icons.ts`, which the
 * achievement badges tint by tier.
 */
import { icon, type IconName } from "./icons.ts";

export const PAINTED_NAMES = [
  "city",
  "palace",
  "fort",
  "port",
  "silo",
  "airDefense",
  "mosque",
  "warship",
  "trade",
  "missile",
  "heavyMissile",
  "demolish",
] as const satisfies readonly IconName[];

export type PaintedName = (typeof PAINTED_NAMES)[number];

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" focusable="false" aria-hidden="true" class="icon-sprite">
  <symbol id="p-city" viewBox="0 0 32 32"><g fill="#fff"><rect x="6" y="14" width="6" height="12" rx="1"/><rect x="13" y="6" width="7" height="20" rx="1"/><rect x="21" y="11" width="5" height="15" rx="1"/></g><path fill="#080e16" fill-opacity=".75" d="M15 10h1.6v2H15zM17.4 10H19v2h-1.6zM15 14h1.6v2H15zM17.4 14H19v2h-1.6zM15 18h1.6v2H15zM17.4 18H19v2h-1.6zM8 17.5h2v2H8zM8 22h2v2H8zM22.6 15h2v2h-2zM22.6 19.5h2v2h-2z"/></symbol>
  <symbol id="p-palace" viewBox="0 0 32 32"><g fill="#fff"><path d="M9 20a7 7.4 0 0 1 14 0z"/><rect x="8" y="20" width="16" height="6"/><rect x="5" y="15" width="4" height="11" rx=".8"/><rect x="23" y="15" width="4" height="11" rx=".8"/><rect x="15.4" y="5" width="1.2" height="7"/><path d="M16.6 5l4.4 1.6-4.4 1.6z"/></g><path fill="#080e16" fill-opacity=".75" d="M14.4 26v-3.2a1.6 1.6 0 0 1 3.2 0V26z"/></symbol>
  <symbol id="p-fort" viewBox="0 0 32 32"><g fill="#fff"><path d="M5 12h4v3h3v-3h4v3h3v-3h4v3h3v-3h-1V26H5z" transform="translate(0 1)"/><rect x="15.4" y="3" width="1.2" height="7"/><path d="M16.6 3l4.4 1.6-4.4 1.6z"/></g><path fill="#080e16" fill-opacity=".75" d="M13 26v-4a3 3 0 0 1 6 0v4z"/></symbol>
  <symbol id="p-port" viewBox="0 0 32 32"><g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="7.5" r="2.3"/><path d="M16 10v15M11 14h10M6.5 18c.6 5 4.4 8 9.5 8s8.9-3 9.5-8"/></g></symbol>
  <symbol id="p-silo" viewBox="0 0 32 32"><g fill="#fff"><path d="M16 2c2.7 2.9 3.5 6.2 3.5 9.8V19h-7v-7.2C12.5 8.2 13.3 4.9 16 2z"/><path d="M4.5 27 8 20.5h16l3.5 6.5z"/></g><path fill="#080e16" fill-opacity=".75" d="M12.5 11.5h7v1.4h-7zM9 22.4h14v1.3H9z"/></symbol>
  <symbol id="p-airDefense" viewBox="0 0 32 32"><g fill="#fff"><rect x="5" y="22" width="22" height="5" rx="1.2"/><path d="M8.5 22a7.5 7.5 0 0 1 15 0z"/></g><path d="M11.5 15.5 6.5 5M20.5 15.5l5-10.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><path fill="#080e16" fill-opacity=".75" d="M16 15.5a6 6 0 0 1 5.6 4.5H16z"/></symbol>
  <symbol id="p-mosque" viewBox="0 0 32 32"><g fill="#fff"><path d="M10 21a6 6.5 0 0 1 12 0z"/><rect x="8" y="21" width="16" height="5"/><circle cx="16" cy="9.2" r="1.1"/><rect x="15.6" y="10" width=".8" height="3"/><path d="M5 26V13l1.5-5.5L8 13v13zM24 26V13l1.5-5.5L27 13v13z"/></g><path fill="#080e16" fill-opacity=".75" d="M14.4 26v-2.4a1.6 1.6 0 0 1 3.2 0V26z"/></symbol>
  <symbol id="p-warship" viewBox="0 0 32 32"><g fill="#fff"><path d="M5 18h22l-3 5.5H8z"/><rect x="10" y="13.5" width="10" height="4.5" rx=".8"/><rect x="13.5" y="9.5" width="5" height="4" rx=".8"/><rect x="15.7" y="5" width="1" height="4.5"/></g><path d="M20 15.5l6.5-2" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><path fill="#080e16" fill-opacity=".75" d="M8 20.5h16v1.2H8.8z"/><path d="M9 26q1.7-1.2 3.4 0t3.4 0 3.4 0 3.4 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".7"/></symbol>
  <symbol id="p-trade" viewBox="0 0 32 32"><g fill="#fff"><path d="M4 18.5h24l-3 5H7z"/><rect x="6.5" y="13.5" width="5.5" height="4.2" rx=".6"/><rect x="13" y="13.5" width="5.5" height="4.2" rx=".6"/><rect x="19.5" y="13.5" width="5.5" height="4.2" rx=".6"/><rect x="9.8" y="8.8" width="5.5" height="4" rx=".6"/><rect x="16.3" y="8.8" width="5.5" height="4" rx=".6"/></g><path d="M9 26.5q1.7-1.2 3.4 0t3.4 0 3.4 0 3.4 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".7"/></symbol>
  <symbol id="p-missile" viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><path fill="#ffb347" d="M16 23q-1.8 2.6 0 5.2 1.8-2.6 0-5.2z"/><g fill="#fff"><path d="M16 2.5c1.9 2.2 2.6 5 2.6 8V22h-5.2V10.5c0-3 .7-5.8 2.6-8z"/><path d="M13.4 18 9.6 24l3.8-.8zM18.6 18l3.8 6-3.8-.8z"/></g></g></symbol>
  <symbol id="p-heavyMissile" viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><path fill="#ffb347" d="M16 21.5q-3.8 4 0 8 3.8-4 0-8z"/><g fill="#fff"><path d="M16 1c3.8 3.2 5.8 7.2 5.8 11.5V22h-11.6v-9.5C10.2 8.2 12.2 4.2 16 1z"/><path d="M10.2 16 5 24l5.2-1.2zM21.8 16l5.2 8-5.2-1.2z"/><path d="M10.2 8.5 7.8 12.5h2.4zM21.8 8.5l2.4 4h-2.4z"/></g><path fill="#080e16" fill-opacity=".75" d="M10.2 11.5h11.6v1.5H10.2zM10.2 16.5h11.6V18H10.2z"/></g></symbol>
  <symbol id="p-demolish" viewBox="0 0 32 32"><g transform="rotate(45 16 16)"><g fill="#fff"><rect x="14.7" y="9" width="2.6" height="19" rx="1.1"/><rect x="7.5" y="3" width="17" height="8" rx="1.8"/></g><path fill="#080e16" fill-opacity=".75" d="M14 3h4v8h-4z"/></g><path d="M5 27h8M20 27h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></symbol>
</svg>`;

const NS = "http://www.w3.org/2000/svg";

/** True for the names that have a pictogram. */
export function isPainted(name: string): name is PaintedName {
  return (PAINTED_NAMES as readonly string[]).includes(name);
}

/** A pictogram on its disc, sized by the stylesheet (`.icon`). */
export function paintedIcon(name: PaintedName): SVGSVGElement {
  if (document.getElementById("p-city") === null) {
    document.body.insertAdjacentHTML("afterbegin", SPRITE);
  }
  const root = document.createElementNS(NS, "svg");
  root.setAttribute("class", "icon painted");
  root.setAttribute("viewBox", "0 0 32 32");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.innerHTML =
    `<circle class="cd" cx="16" cy="16" r="14.5"/><circle class="cr" cx="16" cy="16" r="13.6"/>` +
    `<use href="#p-${name}" transform="translate(.96 .96) scale(.94)"/>`;
  return root;
}

/** The icon of a building or weapon: its pictogram, or the plain glyph where it has none. */
export function pieceIcon(name: IconName): SVGSVGElement {
  return isPainted(name) ? paintedIcon(name) : icon(name);
}
