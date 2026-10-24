import { LocalSession } from "../game/local-session.ts";
import type { MapData, MapInfo } from "../game/maps.ts";
import type { GameSession } from "../game/session.ts";
import { HUMAN_ID, type GameUpdate, type SoloOptions } from "../game/solo-game.ts";
import { InputController } from "../input/controller.ts";
import { applyTranslations, onLanguageChange, t, type MessageKey } from "../i18n/index.ts";
import { playerColor } from "../palette.ts";
import { FlatCamera, type CameraView } from "../render/camera.ts";
import { MapView } from "../render/map-view.ts";
import { endScreen, helpPanel } from "./end-screen.ts";
import { ClickMarks } from "./click-marks.ts";
import { Hud } from "./hud.ts";

/** Size of a tile on screen once the view closes in on the player's start. */
const START_TILE_PIXELS = 6;

export interface GameScreenActions {
  onNewGame(): void;
  onMenu(): void;
  /** The game could not start; the key names the message to show. */
  onFailure(key: MessageKey): void;
}

/**
 * One game on screen: the map, the input that drives the camera and sends
 * orders, the HUD, and the dialogs on top. Owns everything it creates and
 * releases it in dispose().
 */
export class GameScreen {
  readonly element: HTMLElement;
  private owners = new Uint16Array(0);
  private readonly camera: FlatCamera;
  private readonly surface: HTMLElement;
  private view: MapView | undefined;
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
  private readonly marks = new ClickMarks();
  private previousShips = new Map<number, number>();
  private updatedAt = 0;
  /** Something to draw that the camera alone does not show. */
  private dirty = true;
  private drawnView: CameraView | undefined;
  private wrapsX = true;

  constructor(
    readonly options: SoloOptions,
    map: MapInfo,
    private readonly actions: GameScreenActions,
  ) {
    this.camera = new FlatCamera({ width: map.width, height: map.height, wrapsX: map.wrapsX });
    // Input listens on a layer of its own under the HUD, so clicks on panels never reach the map.
    this.surface = document.createElement("div");
    this.surface.className = "map-surface";
    this.surface.id = "map";
    this.surface.setAttribute("role", "application");
    this.surface.dataset.i18nAttr = "aria-label:game.map";
    this.surface.setAttribute("aria-label", t("game.map"));
    this.surface.setAttribute("aria-busy", "true");

    this.hud = new Hud({
      onPause: () => {
        this.togglePause();
      },
      onHelp: () => {
        this.showHelp();
      },
      onMenu: () => {
        this.leave();
      },
    });
    this.element = document.createElement("div");
    this.element.className = "game";
    this.element.append(this.surface, this.marks.element, this.hud.element, this.marks.note);

    this.input = new InputController(this.surface, this.camera, {
      onTileClick: (tile) => {
        this.click(tile);
      },
    });

    this.session = new LocalSession(options, map, {
      onStart: (info) => {
        this.showMap(info.map);
        this.ticksPerSecond = info.rules.ticksPerSecond;
        this.ownableTiles = info.rules.ownableTiles;
        this.hud.setRules(info.rules);
      },
      onUpdate: (update) => {
        this.apply(update);
      },
      onClick: (tile, outcome) => {
        this.marks.show(tile, outcome, performance.now());
      },
      onError: (message) => {
        console.error(message);
        this.actions.onFailure("game.failed");
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
        applyTranslations(this.surface);
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
      // A frame is drawn only when something on the map changed: the GPU
      // idles while nothing moves, during a pause above all.
      const view = this.camera.view();
      const moved = !sameView(view, this.drawnView);
      const sailing = (this.latest?.boats.length ?? 0) > 0;
      if (this.view && (moved || this.dirty || sailing)) {
        this.placeShips(now);
        this.view.render(view);
        this.drawnView = view;
        // Ships still glide after their last tick: one more frame to settle them.
        this.dirty = sailing;
      }
      this.marks.place(this.camera, now);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.session.dispose();
    this.input.dispose();
    this.view?.dispose();
    this.element.remove();
  }

  private showMap(map: MapData): void {
    this.owners = new Uint16Array(map.width * map.height);
    this.wrapsX = map.wrapsX;
    let view: MapView;
    try {
      view = new MapView({
        width: map.width,
        height: map.height,
        kinds: map.kinds,
        wrapsX: map.wrapsX,
        owners: this.owners,
        maxOwner: this.options.bots + 1,
      });
    } catch (error) {
      // Most likely the WebGL context, lost or refused after the check of the menu.
      console.error(error);
      this.actions.onFailure("webgl.missing");
      return;
    }
    for (let id = 1; id <= this.options.bots + 1; id++) {
      view.setPlayerColor(id, playerColor(id - 1).hex);
    }
    view.canvas.classList.add("map-canvas");
    this.surface.append(view.canvas);
    this.surface.removeAttribute("aria-busy");
    this.view = view;
    this.dirty = true;
    this.resize();
  }

  /**
   * Ships glide from where they were on the previous tick to where they are
   * now, over one tick, instead of jumping B-BOAT-SPEED tiles at a time.
   */
  private placeShips(now: number): void {
    const view = this.view;
    const ships = this.latest?.boats;
    if (!view || !ships) return;
    const { width } = this.camera.options;
    const progress = Math.min(1, (now - this.updatedAt) / (1000 / this.ticksPerSecond));
    view.setShips(
      ships.map((ship) => {
        const to = ship.tile;
        const from = this.previousShips.get(ship.id) ?? to;
        const fromX = from % width;
        const toX = to % width;
        // The short way across the seam of a wrapping map.
        let dx = toX - fromX;
        if (this.wrapsX && Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
        const fromY = Math.floor(from / width);
        const toY = Math.floor(to / width);
        return {
          x: fromX + dx * progress,
          y: fromY + (toY - fromY) * progress,
          color: playerColor(ship.player - 1).hex,
        };
      }),
    );
  }

  private resize(): void {
    this.dirty = true;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.view?.resize(width, height);
    this.camera.resize(width, height);
  }

  private apply(update: GameUpdate): void {
    this.previousShips = new Map((this.latest?.boats ?? []).map((ship) => [ship.id, ship.tile]));
    this.updatedAt = performance.now();
    if (update.owners) {
      this.owners.set(update.owners);
      this.view?.markAllChanged();
      this.dirty = true;
    } else if (update.changedTiles.length > 0) {
      const { changedTiles, changedOwners } = update;
      for (let i = 0; i < changedTiles.length; i++) {
        this.owners[changedTiles[i] as number] = changedOwners[i] as number;
      }
      this.view?.markChanged(changedTiles);
      this.dirty = true;
    }
    const human = update.players.find((player) => player.id === HUMAN_ID);
    if (human) this.peakTiles = Math.max(this.peakTiles, human.tiles);
    if (!this.focused && human && human.tiles > 0) {
      // Once, when the player's start appears, picked or placed by the game:
      // on a large map it is a few pixels wide at the zoom that shows it all.
      this.focused = true;
      const start = this.owners.indexOf(HUMAN_ID);
      const zoom = (START_TILE_PIXELS * this.camera.options.height) / this.camera.viewportHeight;
      if (start >= 0) this.camera.focus(start, Math.max(this.camera.zoom, zoom));
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
    this.session.click(tile, this.hud.ratio);
  }

  private key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement && event.target.type === "text") return;
    if (event.code === "Escape" && this.overlay) {
      this.closeOverlay();
      event.preventDefault();
      return;
    }
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

  /** Back to the menu; asks first while the player still has a game to lose. */
  private leave(): void {
    const human = this.latest?.players.find((player) => player.id === HUMAN_ID);
    const playing = !this.ended && human?.alive === true && human.tiles > 0;
    if (playing && !window.confirm(t("hud.leaveConfirm"))) return;
    this.actions.onMenu();
  }

  private togglePause(): void {
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
    if (this.paused) {
      this.paused = false;
      this.session.setPaused(false);
    }
    this.surface.focus();
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

function sameView(a: CameraView, b: CameraView | undefined): boolean {
  return (
    b !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.halfWidth === b.halfWidth &&
    a.halfHeight === b.halfHeight
  );
}
