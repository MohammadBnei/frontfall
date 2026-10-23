import { WorldGrid } from "@frontfall/engine";
import { connect, socketUrl } from "./connection.ts";
import {
  applyTranslations,
  onLanguageChange,
  t,
  type MessageKey,
  type Params,
} from "./i18n/index.ts";
import { InputController } from "./input/controller.ts";
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

connect(socketUrl(location.href), {
  onOpen(send) {
    showStatus("status.joining");
    send({ type: "join", lobby: "public", name: "Guest" });
  },
  onMessage(message) {
    if (message.type === "joined") showStatus("status.connected", { player: message.player });
    if (message.type === "turn" && message.turn.tick % 10 === 0) {
      showStatus("status.turn", { tick: message.turn.tick });
    }
  },
  onClose(retryInMs) {
    showStatus("status.disconnected", { seconds: Math.ceil(retryInMs / 1000) });
  },
});
