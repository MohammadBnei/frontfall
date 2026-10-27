import type { Camera } from "../render/camera.ts";

/** Screen pixels per second, so the map moves at the same pace at any zoom. */
export const KEY_PAN_SPEED = 900;
/** Zoom change per press of + or -. */
export const KEY_ZOOM_STEP = 1.25;
/** A longer frame, such as after the tab was hidden, does not jump the map. */
const MAX_FRAME_MS = 100;

/**
 * Pan directions by physical key, so WASD stays under the same fingers on
 * AZERTY and other layouts.
 */
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

/**
 * Camera moves from the keyboard: held arrows or WASD pan at a steady speed
 * through update(), + and - zoom on the centre of the view. The number row
 * and Space are left alone for game commands, even on layouts where a digit
 * key types "-".
 */
export class KeyboardCamera {
  private readonly held = new Set<string>();

  constructor(private readonly camera: Camera) {}

  /** Returns whether the key was used, so the caller can stop its default action. */
  keyDown(key: string, code: string): boolean {
    if (code in PAN_KEYS) {
      this.held.add(code);
      return true;
    }
    if (code.startsWith("Digit")) return false;
    const zoom =
      code === "NumpadAdd" || key === "+" || key === "="
        ? KEY_ZOOM_STEP
        : code === "NumpadSubtract" || key === "-"
          ? 1 / KEY_ZOOM_STEP
          : 0;
    if (zoom === 0) return false;
    const { viewportWidth, viewportHeight } = this.camera;
    this.camera.zoomAt(zoom, viewportWidth / 2, viewportHeight / 2);
    return true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  /** Lets go of every key, for when the window loses focus and key-ups never arrive. */
  releaseAll(): void {
    this.held.clear();
  }

  /** Moves the camera for the keys held during the last frame. */
  update(dtMs: number): void {
    if (this.held.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const code of this.held) {
      const direction = PAN_KEYS[code];
      if (!direction) continue;
      dx += direction[0];
      dy += direction[1];
    }
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const distance = (KEY_PAN_SPEED * Math.min(MAX_FRAME_MS, Math.max(0, dtMs))) / 1000;
    // The view moves east, so the map content moves west.
    this.camera.panBy((-dx / length) * distance, (-dy / length) * distance);
  }
}

/** Keys typed into a form field are text, not camera moves. */
export function isTextEntry(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const { tagName, isContentEditable } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  return (
    isContentEditable === true ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

/**
 * The command a key stands for, as a `KeyX` code for letters: the letter the
 * layout prints on the key, so M is the key marked M on AZERTY too. A layout
 * without Latin letters falls back to the physical key. Any other character
 * stays itself, so "?" (Shift and the M position on AZERTY) is never M.
 */
export function commandCode(key: string, code: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[^\p{L}]$/u.test(key)) return key;
  return code;
}

/** Controls that act on Enter and Space themselves: the map must not also pick a tile. */
export function isPressable(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const { tagName } = target as { tagName?: unknown };
  return tagName === "BUTTON" || tagName === "A" || tagName === "SUMMARY" || tagName === "LABEL";
}
