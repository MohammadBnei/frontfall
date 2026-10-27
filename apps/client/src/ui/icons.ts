/**
 * The pictograms of the interface (docs/art-direction.md): one sprite of 24-unit glyphs,
 * drawn in a single colour (`currentColor`) with their details cut out, so one drawing
 * serves the HUD, the help and the menus. Accent parts take `--icon-accent` where a
 * context sets it and the text colour elsewhere.
 */
export const ICON_NAMES = [
  "city",
  "fort",
  "port",
  "palace",
  "silo",
  "airDefense",
  "warship",
  "trade",
  "missile",
  "heavyMissile",
  "demolish",
  "pause",
  "help",
  "leave",
  "close",
  "build",
  "trophy",
  "profile",
  "settings",
  "language",
  "account",
  "gift",
  "message",
  "alliance",
  "requests",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" focusable="false" aria-hidden="true" class="icon-sprite">
  <symbol id="i-city" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.5 21V11h5.5v10zM9 21V3h6.5v18zM16.5 21V8h5v13zM11 6h1.2v1.8H11zM13.3 6h1.2v1.8h-1.2zM11 10h1.2v1.8H11zM13.3 10h1.2v1.8h-1.2zM11 14h1.2v1.8H11zM13.3 14h1.2v1.8h-1.2zM4 13.5h1.3v1.6H4zM4 17h1.3v1.6H4zM18 11h1.3v1.6H18zM18 14.5h1.3v1.6H18zM18 18h1.3v1.6H18z"/></symbol>
  <symbol id="i-fort" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 21V4.5h3.6V7h2.2V4.5h4.4V7h2.2V4.5H20V21zM9.8 21v-4.4a2.2 2.2 0 0 1 4.4 0V21zM11.4 10h1.2v3.4h-1.2z"/></symbol>
  <symbol id="i-port" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.2" r="2.3"/><path d="M12 7.5V20M8 11h8M4 14.5c.6 4 4 6 8 6s7.4-2 8-6"/><path d="M2.4 15.6l1.6-2 2 1.6M18 15.2l2-1.7 1.6 2.1"/></g></symbol>
  <symbol id="i-palace" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5 21v-7h2.2C7.4 9.500 9.400 6.800 12 5.400c2.600 1.400 4.600 4.100 4.800 8.600H19v7zM2.500 21V11.500L4 8.500l1.500 3V21zM18.500 21V11.500L20 8.500l1.500 3V21zM11.500 1.500h1V5.400h-1zM7.600 16h1.500v5H7.600zM11.250 16h1.500v5h-1.500zM14.900 16h1.500v5h-1.500z"/><path class="ac" d="M12.500 1.500 16.200 2.900 12.500 4.300z"/></symbol>
  <symbol id="i-silo" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M5.500 21V11L8 8.500h8l2.500 2.500v10zM12 2l2.400 6.100H9.600zM7.500 13h9v1.500h-9zM7.500 17h9v1.500h-9z"/></symbol>
  <symbol id="i-airDefense" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.500 20 5.500v6c0 5-3.400 8.500-8 10-4.600-1.500-8-5-8-10v-6zM12 7 16.600 12.500h-3.100V17h-3V12.500H7.400z"/></symbol>
  <symbol id="i-warship" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.500 15.500h17L22 17.500 19 20.800H6zM8 11.500h8v4H8zM10.400 8.500h3.200v3h-3.200zM5.800 17.300h1.400v1.400H5.800zM8.800 17.300h1.400v1.400H8.800zM11.800 17.300h1.400v1.400h-1.400zM14.800 17.300h1.400v1.400h-1.400z"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 8.500V4" stroke-width="1.300"/><path d="M13.500 9.800 20 8.400" stroke-width="1.800"/></g></symbol>
  <symbol id="i-trade" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.500 17h19L19 21H5zM5 12.400h4.200v4H5zM9.800 12.400H14v4H9.800zM14.600 12.400h4.200v4h-4.200zM7.400 8h4.200v4H7.400zM12.200 8h4.200v4h-4.200z"/></symbol>
  <symbol id="i-missile" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><path fill-rule="evenodd" d="M12 1.800C14.600 5 15.200 9 15.200 13v4H8.800v-4C8.800 9 9.400 5 12 1.800zM8.800 13.500 5.200 18.500l3.600-1zM15.200 13.500l3.600 5-3.600-1zM12 6.800a1.700 1.700 0 1 1 0 3.400 1.700 1.700 0 0 1 0-3.400z"/><path class="ac" d="M10.400 17.400h3.200L12 22.400z"/></g></symbol>
  <symbol id="i-heavyMissile" viewBox="0 0 24 24"><g transform="rotate(45 12 12)"><path fill-rule="evenodd" d="M12 1C15.200 4.500 16.600 8.500 16.600 13v4.600H7.400V13C7.400 8.500 8.800 4.500 12 1zM7.400 13.500 3.800 19.500l3.600-1.500zM16.600 13.500l3.600 6-3.600-1.500zM7.700 11h8.600v1.400H7.700zM7.700 14h8.600v1.400H7.700z"/><path class="ac" d="M9.600 17.800h4.800L12 23z"/></g></symbol>
  <symbol id="i-demolish" viewBox="0 0 24 24"><path d="M5.600 3.800 12 10.200l6.400-6.400 1.800 1.800-6.400 6.400 6.400 6.400-1.800 1.800-6.400-6.400-6.400 6.400-1.800-1.800 6.400-6.400-6.400-6.400z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M6.500 4h4v16h-4zM13.500 4h4v16h-4z"/></symbol>
  <symbol id="i-help" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.200"/><path d="M9.300 9.400a2.800 2.800 0 1 1 4.300 2.300c-1 .6-1.600 1.200-1.600 2.300"/></g><circle cx="12" cy="17.300" r="1.300"/></symbol>
  <symbol id="i-leave" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.500H5.500a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1H10M15.500 7.500 20 12l-4.500 4.500M20 12H9.500"/></g></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M5.800 4 12 10.200 18.200 4 20 5.800 13.800 12 20 18.200 18.200 20 12 13.800 5.800 20 4 18.200 10.200 12 4 5.800z"/></symbol>
  <symbol id="i-build" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.800 22 11.500h-2.800V21H4.800v-9.500H2zM11 11.600v2.400H8.600v2H11v2.400h2V16h2.400v-2H13v-2.400z"/></symbol>
  <symbol id="i-trophy" viewBox="0 0 24 24"><path d="M6.500 2.500h11V9a5.500 5.500 0 0 1-11 0zM10.800 14.200h2.400v3.300h-2.400zM7 18.500h10v2.500H7z"/><path fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" d="M6.500 4.800H3.800V7a3.200 3.200 0 0 0 3.200 3.200M17.500 4.800h2.700V7a3.200 3.200 0 0 1-3.200 3.200"/></symbol>
  <symbol id="i-profile" viewBox="0 0 24 24"><path d="M12 3.500a4.400 4.400 0 1 1 0 8.800 4.400 4.400 0 0 1 0-8.800zM3.800 21c0-4.400 3.600-7 8.200-7s8.200 2.600 8.200 7z"/></symbol>
  <symbol id="i-settings" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 5.400a6.600 6.600 0 1 0 0 13.200 6.600 6.600 0 0 0 0-13.200zm0 4a2.600 2.600 0 1 1 0 5.200 2.600 2.600 0 0 1 0-5.200z"/><g id="teeth"><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(45 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(90 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(135 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(180 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(225 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(270 12 12)"/><rect x="10.200" y="1.800" width="3.600" height="4.600" rx="1" transform="rotate(315 12 12)"/></g></symbol>
  <symbol id="i-language" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.200"/><path d="M2.800 12h18.400M12 2.800c2.600 2.500 3.900 5.600 3.900 9.200s-1.300 6.700-3.900 9.200c-2.600-2.500-3.900-5.600-3.900-9.200S9.400 5.300 12 2.800z"/></g></symbol>
  <symbol id="i-account" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.800" cy="12" r="4.300"/><path d="M12.100 12H21M18 12v3.600M15.200 12v2.600"/></g></symbol>
  <symbol id="i-gift" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 11h16v10H4zM2.800 7.800h18.400V11H2.800zM11 7.800h2V21h-2z"/><path fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" d="M12 7.800C10.800 4.200 7 3.800 7.400 6c.3 1.500 3 1.800 4.600 1.800zM12 7.800c1.200-3.600 5-4 4.600-1.800-.3 1.500-3 1.800-4.600 1.800z"/></symbol>
  <symbol id="i-message" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 3.800h16a1.200 1.200 0 0 1 1.200 1.200v10.200a1.200 1.200 0 0 1-1.200 1.200h-8l-5 4.600v-4.600H4a1.200 1.200 0 0 1-1.200-1.200V5A1.200 1.200 0 0 1 4 3.800zM8 8.600a1.300 1.300 0 1 1 0 2.600 1.300 1.300 0 0 1 0-2.600zM12 8.600a1.300 1.300 0 1 1 0 2.600 1.300 1.300 0 0 1 0-2.600zM16 8.600a1.300 1.300 0 1 1 0 2.600 1.300 1.300 0 0 1 0-2.600z"/></symbol>
  <symbol id="i-alliance" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.600" cy="12" r="5.200"/><circle cx="15.400" cy="12" r="5.200"/></g></symbol>
  <symbol id="i-requests" viewBox="0 0 24 24"><path d="M12 2.800a6 6 0 0 0-6 6v4.200l-2.200 3.800h16.400L18 13V8.800a6 6 0 0 0-6-6zM9.800 19h4.400a2.200 2.200 0 0 1-4.400 0z"/></symbol>
</svg>`;

const NS = "http://www.w3.org/2000/svg";

function installSprite(): void {
  if (document.getElementById("i-city") !== null) return;
  document.body.insertAdjacentHTML("afterbegin", SPRITE);
}

/** An icon of the sprite, sized by the stylesheet (`.icon`). */
export function icon(name: IconName): SVGSVGElement {
  installSprite();
  const root = document.createElementNS(NS, "svg");
  root.setAttribute("class", "icon");
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#i-${name}`);
  root.append(use);
  return root;
}
