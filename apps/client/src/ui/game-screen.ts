import { LocalSession } from "../game/local-session.ts";
import { loadMap } from "../game/maps.ts";
import type { GameSession } from "../game/session.ts";
import { HUMAN_ID, type GameUpdate, type SoloOptions } from "../game/solo-game.ts";
import { InputController } from "../input/controller.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { FlatCamera } from "../render/camera.ts";
import { MapView } from "../render/map-view.ts";
import { endScreen, helpPanel } from "./end-screen.ts";
import { Hud } from "./hud.ts";

export interface GameScreenActions {
  onNewGame(): void;
  onMenu(): void;
}

/**
 * One game on screen: the map, the input that drives the camera and sends
 * orders, the HUD, and the dialogs on top. Owns everything it creates and
 * releases it in dispose().
 */
export class GameScreen {
  readonly element: HTMLElement;
  private readonly owners: Uint16Array;
  private readonly camera: FlatCamera;
  private readonly view: MapView;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly session: GameSession;
  private readonly cleanups: (() => void)[] = [];
  private latest: GameUpdate | undefined;
  private overlay: HTMLElement | undefined;
  private paused = false;
  private ended = false;
  private focused = false;
  private ticksPerSecond = 10;
  private ownableTiles = 1;
  private peakTiles = 0;
  private frameHandle = 0;

  constructor(
    readonly options: SoloOptions,
    private readonly actions: GameScreenActions,
  ) {
    const map = loadMap(options.map);
    this.owners = new Uint16Array(map.width * map.height);
    this.camera = new FlatCamera({ width: map.width, height: map.height });
    this.view = new MapView({
      width: map.width,
      height: map.height,
      kinds: map.kinds,
      owners: this.owners,
      maxOwner: options.bots + 1,
    });
    for (let id = 1; id <= options.bots + 1; id++) {
      this.view.setPlayerColor(id, playerColor(id - 1).hex);
    }
    this.view.canvas.classList.add("map-canvas");
    this.view.canvas.id = "map";

    this.hud = new Hud({
      onPause: () => {
        this.togglePause();
      },
      onHelp: () => {
        this.showHelp();
      },
    });
    this.element = document.createElement("div");
    this.element.className = "game";
    this.element.append(this.view.canvas, this.hud.element);

    this.input = new InputController(this.view.canvas, this.camera, {
      onTileClick: (tile) => {
        this.click(tile);
      },
    });

    this.session = new LocalSession(options, {
      onStart: (info) => {
        this.ticksPerSecond = info.ticksPerSecond;
        this.ownableTiles = info.ownableTiles;
        this.hud.setOwnableTiles(info.ownableTiles);
      },
      onUpdate: (update) => {
        this.apply(update);
      },
      onError: (message) => {
        console.error(message);
      },
    });

    const keydown = (event: KeyboardEvent): void => {
      this.key(event);
    };
    window.addEventListener("keydown", keydown);
    const resize = (): void => {
      this.resize();
    };
    window.addEventListener("resize", resize);
    this.cleanups.push(
      () => {
        window.removeEventListener("keydown", keydown);
      },
      () => {
        window.removeEventListener("resize", resize);
      },
      onLanguageChange(() => {
        this.hud.refresh();
      }),
    );
  }

  /** Call once the element is in the page, so sizes are known. */
  start(): void {
    this.resize();
    let last = performance.now();
    const frame = (now: number): void => {
      this.input.update(now - last);
      last = now;
      this.view.render(this.camera.view());
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.session.dispose();
    this.input.dispose();
    this.view.dispose();
    this.element.remove();
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.view.resize(width, height);
    this.camera.resize(width, height);
  }

  private apply(update: GameUpdate): void {
    if (update.owners) {
      this.owners.set(update.owners);
      this.view.markAllChanged();
    } else if (update.changedTiles.length > 0) {
      const { changedTiles, changedOwners } = update;
      for (let i = 0; i < changedTiles.length; i++) {
        this.owners[changedTiles[i] as number] = changedOwners[i] as number;
      }
      this.view.markChanged(changedTiles);
    }
    const human = update.players.find((player) => player.id === HUMAN_ID);
    if (human) this.peakTiles = Math.max(this.peakTiles, human.tiles);
    if (!this.focused && human && human.tiles > 0 && update.phase === "play") {
      // The player may not have picked a start: show where the game put them.
      this.focused = true;
      const start = this.owners.indexOf(HUMAN_ID);
      if (start >= 0) this.camera.focus(start);
    }
    this.latest = update;
    this.hud.update(update, performance.now());
    if (update.winner !== undefined && !this.ended) {
      this.ended = true;
      this.hud.update(update, performance.now(), true);
      this.showEnd(update);
    }
  }

  private click(tile: number): void {
    const update = this.latest;
    if (!update || this.paused || update.winner !== undefined) return;
    if (update.phase === "spawn") this.focused = true;
    this.session.click(tile, this.hud.ratio);
  }

  private key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement && event.target.type === "text") return;
    if (event.code === "Escape" && this.overlay && !this.ended) {
      this.closeOverlay();
      event.preventDefault();
      return;
    }
    if (this.ended) return;
    if (event.code.startsWith("Digit")) {
      const digit = Number(event.code.slice(5));
      this.hud.setRatio(digit === 0 ? 100 : digit * 10);
      event.preventDefault();
    } else if (event.code === "KeyP" || event.code === "Escape") {
      this.togglePause();
      event.preventDefault();
    } else if (event.code === "KeyH" || event.key === "?") {
      this.showHelp();
      event.preventDefault();
    }
  }

  private togglePause(): void {
    if (this.ended) return;
    if (this.paused) {
      this.closeOverlay();
      return;
    }
    this.paused = true;
    this.session.setPaused(true);
    const banner = document.createElement("div");
    banner.className = "overlay paused";
    const text = document.createElement("p");
    text.className = "paused-text";
    text.textContent = t("hud.paused");
    banner.append(text);
    banner.addEventListener("click", () => {
      this.closeOverlay();
    });
    this.showOverlay(banner);
  }

  private showHelp(): void {
    if (this.ended) return;
    this.paused = true;
    this.session.setPaused(true);
    this.showOverlay(
      helpPanel(() => {
        this.closeOverlay();
      }),
    );
  }

  private showOverlay(element: HTMLElement): void {
    this.overlay?.remove();
    this.overlay = element;
    this.element.append(element);
    element.querySelector<HTMLElement>("button")?.focus();
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = undefined;
    if (this.paused && !this.ended) {
      this.paused = false;
      this.session.setPaused(false);
    }
    this.view.canvas.focus();
  }

  private showEnd(update: GameUpdate): void {
    this.showOverlay(
      endScreen(
        {
          update,
          ticksPerSecond: this.ticksPerSecond,
          ownableTiles: this.ownableTiles,
          peakTiles: this.peakTiles,
        },
        {
          onNewGame: () => {
            this.actions.onNewGame();
          },
          onMenu: () => {
            this.actions.onMenu();
          },
          onWatch: () => {
            this.overlay?.remove();
            this.overlay = undefined;
          },
        },
      ),
    );
  }
}
