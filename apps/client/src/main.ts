import {
  applyTranslations,
  onLanguageChange,
  t,
  type MessageKey,
  type Params,
} from "./i18n/index.ts";
import { OnlineClient, socketUrl } from "./net/online.ts";
import { hasWebGL2 } from "./render/webgl-support.ts";
import { GameScreen } from "./ui/game-screen.ts";
import { Menu } from "./ui/menu.ts";
import { initialSetup, safeStorage, saveSetup, setupQuery, type GameSetup } from "./ui/setup.ts";

const storage = safeStorage();
let menu: Menu | undefined;
let game: GameScreen | undefined;
let setup = initialSetup(location.search, storage);

function showMenu(): void {
  game?.dispose();
  game = undefined;
  document.body.classList.remove("playing");
  menu = new Menu(setup, play);
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
  game?.dispose();
  const seed = Math.floor(Math.random() * 0x7fffffff);
  try {
    game = new GameScreen(
      { ...setup, playerName: setup.playerName || t("menu.namePlaceholder"), seed },
      {
        onNewGame: () => {
          play(setup);
        },
        onMenu: showMenu,
      },
    );
  } catch (error) {
    // Most likely the WebGL context, lost or refused after the check above.
    console.error(error);
    game = undefined;
    showNotice("webgl.missing");
    return;
  }
  menu?.element.remove();
  menu = undefined;
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
showMenu();

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

const online = new OnlineClient({
  url: socketUrl(location.href),
  name: "Guest",
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

// An invite link carries the game id: ?game=<id>. Otherwise join the next public game.
const invited = new URLSearchParams(location.search).get("game");
if (invited) online.join(invited);
else online.play();
