import { applyTranslations, onLanguageChange, t, type MessageKey } from "./i18n/index.ts";
import { fetchMaps, type MapInfo } from "./game/maps.ts";
import { BUILD } from "./net/build.ts";
import { OnlineClient, socketUrl, type GameStart, type OnlineEntry } from "./net/online.ts";
import { hasWebGL2 } from "./render/webgl-support.ts";
import { GameScreen } from "./ui/game-screen.ts";
import { LobbyScreen } from "./ui/lobby.ts";
import { Menu } from "./ui/menu.ts";
import { initialSetup, safeStorage, saveSetup, setupQuery, type GameSetup } from "./ui/setup.ts";

const storage = safeStorage();
let maps: readonly MapInfo[] = [];
let menu: Menu | undefined;
let game: GameScreen | undefined;
let setup: GameSetup;
let lobby: LobbyScreen | undefined;
let online: OnlineClient | undefined;

function showMenu(): void {
  goOffline();
  game?.dispose();
  game = undefined;
  menu?.dispose();
  document.body.classList.remove("playing");
  menu = new Menu(setup, maps, play, (entry, chosen) => {
    setup = chosen;
    saveSetup(setup, storage);
    goOnline(entry, chosen);
  });
  document.body.prepend(menu.element);
  // Ready for Enter, without scrolling a phone's menu down to the button.
  menu.element.querySelector<HTMLButtonElement>("#play")?.focus({ preventScroll: true });
}

/**
 * `?speed=` and `?minutes=` let end-to-end tests play a whole game in
 * seconds; nothing in the interface sets them.
 */
const testing = (() => {
  const params = new URLSearchParams(location.search);
  const number = (name: string, max: number): number | undefined => {
    const value = Number(params.get(name));
    return params.has(name) && value > 0 && value <= max ? value : undefined;
  };
  return { speed: number("speed", 100), maxMinutes: number("minutes", 60) };
})();

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
    { ...setup, playerName: setup.playerName || t("menu.namePlaceholder"), seed, ...testing },
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

onLanguageChange(() => {
  applyTranslations(document);
  lobby?.refresh();
});

/** The address of a private game, to share: this page with `?game=<id>`. */
function inviteLink(game: string): string {
  const url = new URL(location.href);
  url.search = new URLSearchParams({ game }).toString();
  url.hash = "";
  return url.href;
}

/** Leaves the online game, if any, and closes the connection. */
function goOffline(): void {
  online?.leave();
  online?.close();
  online = undefined;
  lobby?.dispose();
  lobby = undefined;
}

/**
 * An online game, from the lobby to the end: the connection reports the
 * lobby until the start, then the game screen plays the turns it relays.
 * Online games are played on the World map, with the bots the server asks for.
 */
function goOnline(entry: OnlineEntry, chosen: GameSetup = setup): void {
  if (!hasWebGL2()) {
    showNotice("webgl.missing");
    return;
  }
  menu?.dispose();
  menu = undefined;
  game?.dispose();
  game = undefined;
  goOffline();
  document.querySelector(".notice")?.remove();
  const room = new LobbyScreen({
    onStart: () => {
      online?.start();
    },
    onLeave: () => {
      goOffline();
      history.replaceState(null, "", setupQuery(setup));
      showMenu();
    },
  });
  lobby = room;
  document.body.prepend(room.element);
  const client = new OnlineClient({
    url: socketUrl(location.href),
    name: chosen.playerName || t("menu.namePlaceholder"),
    build: BUILD,
    events: {
      status(state, retryInMs) {
        if (state === "connecting") room.connecting();
        if (state === "offline") room.connecting(retryInMs ?? 0);
        if (state === "outdated") {
          room.outdated();
          if (game) showNotice("status.outdated");
        }
      },
      lobby(state) {
        // A private game is joined again from its link, after a reload too.
        if (state.visibility === "private") {
          history.replaceState(
            null,
            "",
            `?${new URLSearchParams({ game: state.game }).toString()}`,
          );
        }
        room.lobby(state, inviteLink(state.game));
      },
      started(start) {
        startOnline(start, client);
      },
      turns(turns) {
        game?.pushTurns(turns);
      },
      desync() {
        showNotice("online.desync");
      },
      ended(reason) {
        if (game) {
          if (reason !== "left") showNotice(`online.ended.${reason}`);
          return;
        }
        room.ended(reason);
      },
      error(code, message) {
        room.refused(code, message);
      },
    },
  });
  online = client;
  if (entry.type === "play") client.play();
  else if (entry.type === "create") client.create();
  else client.join(entry.game);
}

/** The game starts: the lobby gives way to the map, and the turns go to the worker. */
function startOnline(start: GameStart, client: OnlineClient): void {
  const map = maps.find((candidate) => candidate.id === start.map);
  if (!map) {
    lobby?.refused("not_found", start.map);
    return;
  }
  lobby?.dispose();
  lobby = undefined;
  const leave = (): void => {
    goOffline();
    history.replaceState(null, "", setupQuery(setup));
    showMenu();
  };
  game = new GameScreen(
    {
      map: start.map,
      seed: start.seed,
      bots: start.bots,
      // The same for every client of the game, which all run the same bots.
      difficulty: "normal",
      playerName: "",
      players: start.players,
      you: start.you,
    },
    map,
    {
      onNewGame: leave,
      onMenu: leave,
      onFailure: (key) => {
        leave();
        showNotice(key);
      },
    },
    {
      order: (order) => {
        client.order(order);
      },
      hash: (tick, hash) => {
        client.hash(tick, hash);
      },
    },
  );
  document.body.classList.add("playing");
  document.body.prepend(game.element);
  game.start();
}

const query = new URLSearchParams(location.search);
const invited = query.get("game");
const ready = fetchMaps(location.href).then((list) => {
  maps = list;
  setup = initialSetup(location.search, storage, maps);
});
void ready.then(() => {
  // An invitation link joins its game; ?online, the next public one.
  if (invited) goOnline({ type: "join", game: invited });
  else if (query.has("online")) goOnline({ type: "play" });
  else showMenu();
});
