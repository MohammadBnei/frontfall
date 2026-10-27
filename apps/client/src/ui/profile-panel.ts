import { PLAYER_COLORS } from "../palette.ts";
import {
  applyTranslations,
  getLanguage,
  onLanguageChange,
  t,
  type MessageKey,
} from "../i18n/index.ts";
import { h, swatch } from "./dom.ts";
import { COLOR_CHOICES, type Profile } from "./profile.ts";

/** What the profile panel reads and changes; the page keeps the profile on the device. */
export interface ProfileControl {
  read(): Profile;
  setColor(index: number): void;
  /** Erases the name, the colour and the games from the device. */
  forget(): void;
}

/** The menu's profile: the colour for solo games, the last games, and a way to erase both. */
export function profilePanel(
  control: ProfileControl,
  mapLabel: (id: string) => string,
  /** Called after the profile is erased, so the menu can empty its name field. */
  onForgotten: () => void,
  cleanups: (() => void)[],
): HTMLElement {
  const colors = h("div", {
    class: "color-choices",
    role: "radiogroup",
    "aria-labelledby": "profile-color-label",
  });
  const inputs: HTMLInputElement[] = [];
  for (let index = 0; index < COLOR_CHOICES; index++) {
    const input = h("input", { type: "radio", name: "profile-color", value: index });
    input.addEventListener("change", () => {
      control.setColor(index);
    });
    inputs.push(input);
    colors.append(
      h(
        "label",
        {
          class: "color-choice",
          "data-i18n-attr": `title:profile.color.${String(index)};aria-label:profile.color.${String(index)}`,
        },
        input,
        swatch((PLAYER_COLORS[index] ?? PLAYER_COLORS[0] ?? { hex: "#56B4E9" }).hex),
      ),
    );
  }

  const list = h("ol", { class: "recent-games", id: "recent-games" });
  const empty = h("p", { class: "hint", "data-i18n": "profile.noGames" });
  const forget = h("button", {
    type: "button",
    class: "secondary",
    id: "profile-forget",
    "data-i18n": "profile.forget",
  });

  const refresh = (): void => {
    const profile = control.read();
    inputs.forEach((input, index) => {
      input.checked = index === profile.color;
    });
    const date = new Intl.DateTimeFormat(getLanguage(), { day: "numeric", month: "short" });
    empty.hidden = profile.games.length > 0;
    list.replaceChildren(
      ...profile.games.map((game) =>
        h(
          "li",
          { class: `recent-game ${game.outcome}` },
          t("profile.game", {
            map: game.map === "generated" ? t("profile.generatedMap") : mapLabel(game.map),
            mode: t(`profile.mode.${game.mode}` as MessageKey),
            outcome: t(`profile.outcome.${game.outcome}` as MessageKey),
            minutes: game.minutes,
            date: date.format(game.at),
          }),
        ),
      ),
    );
  };
  forget.addEventListener("click", () => {
    control.forget();
    refresh();
    onForgotten();
  });
  cleanups.push(onLanguageChange(refresh));
  refresh();

  const panel = h(
    "details",
    { class: "menu-profile", id: "menu-profile" },
    h("summary", { "data-i18n": "profile.heading" }),
    h(
      "div",
      { class: "profile-body" },
      h(
        "div",
        { class: "field" },
        h("span", {
          id: "profile-color-label",
          class: "field-label",
          "data-i18n": "profile.color",
        }),
        colors,
        h("p", { class: "hint", "data-i18n": "profile.colorHint" }),
      ),
      h(
        "div",
        { class: "field" },
        h("span", { class: "field-label", "data-i18n": "profile.games" }),
        list,
        empty,
      ),
      h("p", { class: "hint", "data-i18n": "profile.storedHere" }),
      forget,
    ),
  );
  applyTranslations(panel);
  return panel;
}
