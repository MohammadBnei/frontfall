import { generateMap, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS, type Difficulty } from "../game/solo-game.ts";
import {
  LANGUAGES,
  applyTranslations,
  getLanguage,
  onLanguageChange,
  setLanguage,
  type Language,
} from "../i18n/index.ts";
import { MAP_COLORS, hexToRgb } from "../palette.ts";
import { h } from "./dom.ts";
import { MAX_NAME_LENGTH, cleanName, type GameSetup } from "./setup.ts";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/**
 * The main menu: name, map, bots and difficulty, and one button to play.
 * Everything is prefilled, so a new player starts a game in two clicks.
 */
export class Menu {
  readonly element: HTMLElement;
  private setup: GameSetup;
  private readonly cleanups: (() => void)[] = [];

  constructor(initial: GameSetup, mapList: readonly MapInfo[], onPlay: (setup: GameSetup) => void) {
    this.setup = { ...initial };

    const name = h("input", {
      id: "player-name",
      type: "text",
      maxlength: MAX_NAME_LENGTH,
      autocomplete: "nickname",
      spellcheck: false,
      "data-i18n-attr": "placeholder:menu.namePlaceholder",
    });
    name.value = this.setup.playerName;
    name.addEventListener("input", () => {
      this.setup.playerName = cleanName(name.value);
    });

    const maps = h("div", {
      class: "map-list",
      role: "radiogroup",
      "aria-labelledby": "map-label",
    });
    for (const info of mapList) {
      const input = h("input", { type: "radio", name: "map", value: info.id });
      input.checked = info.id === this.setup.map;
      input.addEventListener("change", () => {
        this.setup.map = info.id;
        if (!botsTouched) {
          this.setup.bots = info.suggestedBots;
          bots.value = String(info.suggestedBots);
          botsValue.textContent = bots.value;
        }
      });
      maps.append(
        h(
          "label",
          { class: "map-card" },
          input,
          thumbnail(info),
          this.mapName(info),
          h("span", {
            class: "map-size",
            "data-i18n": "map.size",
            "data-i18n-params": JSON.stringify({ width: info.width, height: info.height }),
          }),
        ),
      );
    }

    let botsTouched = false;
    const bots = h("input", {
      id: "bot-count",
      type: "range",
      min: 1,
      max: MAX_BOTS,
      step: 1,
    });
    bots.value = String(this.setup.bots);
    const botsValue = h("output", { for: "bot-count", class: "range-value" }, bots.value);
    bots.addEventListener("input", () => {
      botsTouched = true;
      this.setup.bots = Number(bots.value);
      botsValue.textContent = bots.value;
    });

    const difficulty = h("div", {
      class: "segmented",
      role: "radiogroup",
      "aria-labelledby": "difficulty-label",
    });
    for (const level of DIFFICULTIES) {
      const input = h("input", { type: "radio", name: "difficulty", value: level });
      input.checked = level === this.setup.difficulty;
      input.addEventListener("change", () => {
        this.setup.difficulty = level;
      });
      const label = h("span", { "data-i18n": `difficulty.${level}` });
      difficulty.append(h("label", {}, input, label));
    }

    const language = h("select", { id: "language", "data-i18n-attr": "aria-label:menu.language" });
    for (const { id, label } of LANGUAGES) {
      const option = h("option", { value: id, lang: id }, label);
      option.selected = id === getLanguage();
      language.append(option);
    }
    language.addEventListener("change", () => {
      setLanguage(language.value as Language);
    });

    const form = h(
      "form",
      { class: "menu-form" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "player-name", "data-i18n": "menu.name" }),
        name,
      ),
      h(
        "div",
        { class: "field" },
        h("span", { id: "map-label", class: "field-label", "data-i18n": "menu.map" }),
        maps,
      ),
      h(
        "div",
        { class: "field-row" },
        h(
          "div",
          { class: "field" },
          h("label", { for: "bot-count", "data-i18n": "menu.bots" }),
          h("div", { class: "range" }, bots, botsValue),
        ),
        h(
          "div",
          { class: "field" },
          h("span", {
            id: "difficulty-label",
            class: "field-label",
            "data-i18n": "menu.difficulty",
          }),
          difficulty,
        ),
      ),
      h("button", { type: "submit", class: "primary", id: "play", "data-i18n": "menu.play" }),
      h("p", { class: "hint", "data-i18n": "menu.onlineSoon" }),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onPlay({ ...this.setup });
    });

    this.element = h(
      "main",
      { class: "menu", id: "menu" },
      h(
        "header",
        { class: "menu-header" },
        h("img", { class: "logo", src: "./logo-horizontal-on-dark.svg", alt: "Frontfall" }),
        h("p", { class: "tagline", "data-i18n": "menu.tagline" }),
      ),
      form,
      h("footer", { class: "menu-footer" }, language),
    );
    applyTranslations(this.element);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element.remove();
  }

  /** Published maps bring their names in every language; generated ones use the catalogues. */
  private mapName(info: MapInfo): HTMLElement {
    const { name } = info;
    if (!name) return h("span", { class: "map-name", "data-i18n": `map.${info.id}` });
    const element = h("span", { class: "map-name" }, name[getLanguage()]);
    this.cleanups.push(
      onLanguageChange((language) => {
        element.textContent = name[language];
      }),
    );
    return element;
  }
}

/** Small picture of a map: the published thumbnail, or drawn from a generated terrain. */
function thumbnail(info: MapInfo): HTMLElement {
  if (info.thumbnail) {
    return h("img", { class: "map-thumb", src: info.thumbnail, alt: "", loading: "lazy" });
  }
  const map = generateMap(info.id);
  const scale = Math.max(1, Math.ceil(map.width / 160));
  const width = Math.floor(map.width / scale);
  const height = Math.floor(map.height / scale);
  const canvas = h("canvas", { class: "map-thumb", width, height, "aria-hidden": "true" });
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const image = context.createImageData(width, height);
  const land = hexToRgb(MAP_COLORS.landHigh);
  const ocean = hexToRgb(MAP_COLORS.ocean);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = map.kinds[y * scale * map.width + x * scale];
      image.data.set([...(kind === 0 ? ocean : land), 255], (y * width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
