import {
  applyTranslations,
  onLanguageChange,
  t,
  type MessageKey,
  type Params,
} from "./i18n/index.ts";
import { fetchMaps, type MapInfo } from "./game/maps.ts";
import { BUILD } from "./net/build.ts";
import { OnlineClient, socketUrl } from "./net/online.ts";
import { hasWebGL2 } from "./render/webgl-support.ts";
import { GameScreen } from "./ui/game-screen.ts";
import { Menu } from "./ui/menu.ts";
import { initialSetup, safeStorage, saveSetup, setupQuery, type GameSetup } from "./ui/setup.ts";

const storage = safeStorage();
let maps: readonly MapInfo[] = [];
let menu: Menu | undefined;
let game: GameScreen | undefined;
let setup: GameSetup;

function showMenu(): void {
  game?.dispose();
  game = undefined;
  menu?.dispose();
  document.body.classList.remove("playing");
  menu = new Menu(setup, maps, play);
  document.body.prepend(menu.element);
  menu.element.querySelector<HTMLButtonElement>("#play")?.focus();
}

function play(chosen: GameSetup): void {
  setup = chosen;
  saveSetup(setup, storage);
  // Share the setup through the address bar, relative so it works under any prefix.
  history.replaceState(null, "", setupQuery(setup));
  if (!hasWebGL2()) {
    showNotice("webgl.missing");
    return;
  }
  const map = maps.find((candidate) => candidate.id === setup.map);
  if (!map) return;
  game?.dispose();
  const seed = Math.floor(Math.random() * 0x7fffffff);
  game = new GameScreen(
    { ...setup, playerName: setup.playerName || t("menu.namePlaceholder"), seed },
    map,
    {
      onNewGame: () => {
        play(setup);
      },
      onMenu: showMenu,
      onFailure: (key) => {
        showMenu();
        showNotice(key);
      },
    },
  );
  menu?.dispose();
  menu = undefined;
  document.querySelector(".notice")?.remove();
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
}

/** A message over the menu, translated again if the language changes. */
function showNotice(key: MessageKey): void {
  document.querySelector(".notice")?.remove();
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  notice.dataset.i18n = key;
  notice.textContent = t(key);
  document.body.append(notice);
}

// iOS Safari zooms the page on a pinch even over a canvas with touch-action: none.
document.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

applyTranslations(document);
void fetchMaps(location.href).then((list) => {
  maps = list;
  setup = initialSetup(location.search, storage, maps);
  showMenu();
});

const status = document.querySelector<HTMLElement>("#status");
let shownStatus: { key: MessageKey; params: Params } = { key: "status.connecting", params: {} };
const showStatus = (key: MessageKey, params: Params = {}): void => {
  shownStatus = { key, params };
  if (status) status.textContent = t(key, params);
};
onLanguageChange(() => {
  applyTranslations(document);
  showStatus(shownStatus.key, shownStatus.params);
});

const seconds = (ms: number): number => Math.ceil(ms / 1000);

/**
 * The online client until the lobby screens arrive: it connects only when the
 * address asks for it, with ?game=<id> from an invitation link or ?online for
 * the next public game, so a solo player never sits in the public queue.
 */
function goOnline(entry: { game: string } | "public"): void {
  if (status) status.hidden = false;
  const online = new OnlineClient({
    url: socketUrl(location.href),
    name: "Guest",
    build: BUILD,
    events: {
      status(state, retryInMs) {
        if (state === "connecting") showStatus("status.connecting");
        if (state === "offline")
          showStatus("status.disconnected", { seconds: seconds(retryInMs ?? 0) });
        if (state === "outdated") showStatus("status.outdated");
      },
      lobby(lobby) {
        const count = { players: lobby.players.length, capacity: lobby.capacity };
        if (lobby.startsIn === null) showStatus("status.waiting", count);
        else showStatus("status.starting", { ...count, seconds: seconds(lobby.startsIn) });
      },
      started(game) {
        showStatus("status.playing", { player: game.you });
      },
      turns(turns) {
        const last = turns.at(-1)?.tick ?? 0;
        if (last % 10 === 0) showStatus("status.turn", { tick: last });
      },
      ended() {
        showStatus("status.ended");
      },
      error(_code, message) {
        showStatus("status.refused", { message });
      },
    },
  });

  if (entry === "public") online.play();
  else online.join(entry.game);
}

const query = new URLSearchParams(location.search);
const invited = query.get("game");
if (invited) goOnline({ game: invited });
else if (query.has("online")) goOnline("public");
