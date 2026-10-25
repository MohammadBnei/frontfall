import { describe, expect, it } from "vitest";
import {
  KEY_PAN_SPEED,
  KEY_ZOOM_STEP,
  KeyboardCamera,
  commandCode,
  isTextEntry,
} from "../src/input/keyboard.ts";
import { FlatCamera } from "../src/render/camera.ts";

function setup() {
  const camera = new FlatCamera({ width: 512, height: 256 });
  camera.resize(1200, 800);
  camera.zoomAt(4, 600, 400);
  return { camera, keys: new KeyboardCamera(camera) };
}

describe("KeyboardCamera", () => {
  it("pans the same distance whatever the frame rate", () => {
    const slow = setup();
    const fast = setup();
    slow.keys.keyDown("ArrowRight", "ArrowRight");
    fast.keys.keyDown("d", "KeyD");
    for (let frame = 0; frame < 30; frame++) slow.keys.update(1000 / 30);
    for (let frame = 0; frame < 144; frame++) fast.keys.update(1000 / 144);
    const expected = 256 + KEY_PAN_SPEED / slow.camera.scale;
    expect(slow.camera.view().centerX).toBeCloseTo(expected);
    expect(fast.camera.view().centerX).toBeCloseTo(expected);
  });

  it("wraps east-west and stops when the key is released", () => {
    const { camera, keys } = setup();
    keys.keyDown("a", "KeyA");
    for (let frame = 0; frame < 300; frame++) keys.update(100);
    const travelled = (300 * KEY_PAN_SPEED * 0.1) / camera.scale;
    expect(camera.view().centerX).toBeCloseTo((((256 - travelled) % 512) + 512) % 512);
    keys.keyUp("KeyA");
    const stopped = camera.view().centerX;
    keys.update(100);
    expect(camera.view().centerX).toBe(stopped);
  });

  it("caps long frames and moves diagonally at the same speed", () => {
    const { camera, keys } = setup();
    keys.keyDown("w", "KeyW");
    keys.keyDown("ArrowLeft", "ArrowLeft");
    keys.update(5000);
    const { centerX, centerY } = camera.view();
    const moved = Math.hypot(centerX - 256, centerY - 128) * camera.scale;
    expect(moved).toBeCloseTo((KEY_PAN_SPEED * 100) / 1000);
    keys.keyDown("s", "KeyS");
    keys.keyDown("ArrowRight", "ArrowRight");
    keys.update(16);
    expect(camera.view()).toMatchObject({ centerX, centerY });
    keys.releaseAll();
  });

  it("zooms with + and - on the main keys and the numpad", () => {
    const { camera, keys } = setup();
    expect(keys.keyDown("+", "Equal")).toBe(true);
    expect(keys.keyDown("=", "Equal")).toBe(true);
    expect(keys.keyDown("+", "NumpadAdd")).toBe(true);
    expect(camera.zoom).toBeCloseTo(4 * KEY_ZOOM_STEP ** 3);
    expect(keys.keyDown("-", "Minus")).toBe(true);
    expect(keys.keyDown("-", "NumpadSubtract")).toBe(true);
    expect(camera.zoom).toBeCloseTo(4 * KEY_ZOOM_STEP);
    expect(camera.view().centerX).toBeCloseTo(256);
  });

  it("leaves Space, the number row and other keys to the game", () => {
    const { camera, keys } = setup();
    // On AZERTY the 6 key types "-" unshifted.
    for (const [key, code] of [
      [" ", "Space"],
      ["1", "Digit1"],
      ["-", "Digit6"],
      ["9", "Numpad9"],
      ["q", "KeyQ"],
    ] as const) {
      expect(keys.keyDown(key, code)).toBe(false);
    }
    keys.update(100);
    expect(camera.zoom).toBe(4);
    expect(camera.view().centerX).toBe(256);
  });
});

describe("isTextEntry", () => {
  it("recognises form fields and editable content", () => {
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "SELECT" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: "CANVAS", isContentEditable: false })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry("INPUT")).toBe(false);
  });
});

describe("commandCode", () => {
  it("follows the letter the layout prints, so M on AZERTY is M", () => {
    // On AZERTY, the key marked M sits where QWERTY has the semicolon.
    expect(commandCode("m", "Semicolon")).toBe("KeyM");
    expect(commandCode("C", "KeyC")).toBe("KeyC");
  });

  it("falls back to the physical key on layouts without Latin letters", () => {
    expect(commandCode("с", "KeyC")).toBe("KeyC");
    expect(commandCode("Dead", "KeyC")).toBe("KeyC");
  });

  it("keeps other characters, so ? on AZERTY is not the M position", () => {
    // AZERTY: Shift and the key at the QWERTY M position type "?".
    expect(commandCode("?", "KeyM")).toBe("?");
    expect(commandCode(",", "KeyM")).toBe(",");
    expect(commandCode("?", "Slash")).toBe("?");
  });
});
