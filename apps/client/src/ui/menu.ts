import { MAP_GROUPS, generateMap, type MapInfo } from "../game/maps.ts";
import { MAX_BOTS, type Difficulty } from "../game/solo-game.ts";
import {
  LANGUAGES,
  applyTranslations,
  getLanguage,
  onLanguageChange,
  setLanguage,
  t,
  type Language,
} from "../i18n/index.ts";
import type { OnlineEntry } from "../net/online.ts";
import { MAP_COLORS, hexToRgb } from "../palette.ts";
import { betaBadge, betaNotice } from "./beta.ts";
import { h, present } from "./dom.ts";
import { MAX_NAME_LENGTH, cleanName, type GameSetup } from "./setup.ts";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
/** How often the list of public games is fetched again while the menu shows. */
const GAMES_REFRESH_MS = 3_000;

/** A public game waiting for players, as `/api/games` lists it. */
interface PublicGame {
  id: string;
  map: string;
  players: number;
  capacity: number;
}

/**
 * The main menu: name, map, bots and difficulty, and one button to play.
 * Everything is prefilled, so a new player starts a game in two clicks.
 */
export class Menu {
  readonly element: HTMLElement;
  private setup: GameSetup;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    initial: GameSetup,
    mapList: readonly MapInfo[],
    onPlay: (setup: GameSetup) => void,
    onOnline: (entry: OnlineEntry, setup: GameSetup) => void,
  ) {
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
      class: "map-groups",
      role: "radiogroup",
      "aria-labelledby": "map-label",
    });
    const lists = new Map(
      MAP_GROUPS.map((group) => [group, h("div", { class: "map-list" })] as const),
    );
    for (const group of MAP_GROUPS) {
      const list = lists.get(group);
      if (!list || !mapList.some((info) => info.group === group)) continue;
      const label = h("span", { class: "map-group-label", "data-i18n": `menu.maps.${group}` });
      maps.append(label, list);
    }
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
      lists.get(info.group)?.append(
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
    );
    const online = this.onlineSection(mapList, (entry) => {
      onOnline(entry, { ...this.setup });
    });
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
        ...present(betaBadge("beta-menu")),
        h("p", { class: "tagline", "data-i18n": "menu.tagline" }),
        ...present(betaNotice()),
      ),
      form,
      online,
      h("footer", { class: "menu-footer" }, language),
    );
    applyTranslations(this.element);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.element.remove();
  }

  /**
   * Online play: the next public game, a new private one, or a public game
   * from the list, which is fetched again every few seconds.
   */
  private onlineSection(
    mapList: readonly MapInfo[],
    enter: (entry: OnlineEntry) => void,
  ): HTMLElement {
    const button = (id: string, key: string, entry: OnlineEntry): HTMLElement => {
      const element = h("button", { type: "button", class: "secondary", id, "data-i18n": key });
      element.addEventListener("click", () => {
        enter(entry);
      });
      return element;
    };
    const list = h("ul", { class: "public-games", id: "public-games" });
    const empty = h("p", { class: "hint", "data-i18n": "online.noGames" });
    const games = h(
      "div",
      { class: "field", hidden: true },
      h("span", { class: "field-label", "data-i18n": "online.games" }),
      list,
      empty,
    );
    const mapLabel = (id: string): string => {
      const info = mapList.find((candidate) => candidate.id === id);
      return info?.name?.[getLanguage()] ?? id;
    };
    const show = (found: readonly PublicGame[]): void => {
      games.hidden = false;
      empty.hidden = found.length > 0;
      list.replaceChildren(
        ...found.map((game) => {
          const join = h("button", { type: "button", class: "secondary" }, t("online.join"));
          join.addEventListener("click", () => {
            enter({ type: "join", game: game.id });
          });
          return h(
            "li",
            { class: "public-game" },
            h(
              "span",
              {},
              t("online.gameRow", {
                map: mapLabel(game.map),
                players: game.players,
                capacity: game.capacity,
              }),
            ),
            join,
          );
        }),
      );
    };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("api/games", location.href));
        const body: unknown = response.ok ? await response.json() : undefined;
        // The menu may have closed while the request ran.
        if (!stopped) show(publicGames(body));
      } catch {
        // No server next to the page, as in a static preview: the buttons stay.
      }
      if (!stopped) {
        timer = setTimeout(() => {
          void refresh();
        }, GAMES_REFRESH_MS);
      }
    };
    void refresh();
    this.cleanups.push(() => {
      stopped = true;
      clearTimeout(timer);
    });
    return h(
      "section",
      { class: "menu-online", "aria-labelledby": "online-heading" },
      h("h2", { id: "online-heading", "data-i18n": "online.heading" }),
      h(
        "div",
        { class: "online-actions" },
        button("online-play", "online.quick", { type: "play" }),
        button("online-create", "online.create", { type: "create" }),
      ),
      games,
    );
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

/** The games of a `/api/games` answer, leaving out anything malformed. */
function publicGames(body: unknown): PublicGame[] {
  const games = (body as { games?: unknown } | undefined)?.games;
  if (!Array.isArray(games)) return [];
  return games.filter(
    (game): game is PublicGame =>
      typeof game === "object" &&
      game !== null &&
      typeof (game as PublicGame).id === "string" &&
      typeof (game as PublicGame).map === "string" &&
      Number.isInteger((game as PublicGame).players) &&
      Number.isInteger((game as PublicGame).capacity),
  );
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
