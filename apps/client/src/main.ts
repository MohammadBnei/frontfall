import { WorldGrid } from "@frontfall/engine";
import {
  applyTranslations,
  onLanguageChange,
  t,
  type MessageKey,
  type Params,
} from "./i18n/index.ts";
import { InputController } from "./input/controller.ts";
import { OnlineClient, socketUrl } from "./net/online.ts";
import { FlatCamera } from "./render/camera.ts";
import { MapView } from "./render/map-view.ts";
import { WEBGL_MISSING_MESSAGE, hasWebGL2 } from "./render/webgl-support.ts";
import { generateLand } from "./terrain.ts";

const grid = new WorldGrid(512, 256);
const land = generateLand(grid, 2026);

function showNotice(text: string): void {
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  notice.textContent = text;
  document.body.append(notice);
}

function startMap(): void {
  const camera = new FlatCamera({ width: grid.width, height: grid.height });
  const view = new MapView({ width: grid.width, height: grid.height, land, camera });
  document.body.append(view.canvas);
  const input = new InputController(view.canvas, camera);

  const resize = (): void => {
    view.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", resize);
  resize();

  let last = performance.now();
  const frame = (now: number): void => {
    input.update(now - last);
    last = now;
    view.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// iOS Safari zooms the page on a pinch even over a canvas with touch-action: none.
document.addEventListener("gesturestart", (event) => {
  event.preventDefault();
});

if (hasWebGL2()) {
  try {
    startMap();
  } catch (error) {
    console.error(error);
    showNotice(WEBGL_MISSING_MESSAGE);
  }
} else {
  showNotice(WEBGL_MISSING_MESSAGE);
}

applyTranslations(document);

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
