import { describe, expect, it, vi } from "vitest";
import { InputController } from "../src/input/controller.ts";
import { FlatCamera } from "../src/render/camera.ts";

/** A map element 20 px from the top of the page, without a DOM. */
class FakeElement extends EventTarget {
  readonly captured: number[] = [];

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 20 };
  }

  setPointerCapture(id: number): void {
    if (id < 0) throw new Error("no such pointer");
    this.captured.push(id);
  }
}

function event<T extends object>(type: string, fields: T, target?: object): Event & T {
  const result = Object.assign(new Event(type, { cancelable: true }), fields);
  if (target) Object.defineProperty(result, "target", { value: target });
  return result;
}

const pointer = (type: string, id: number, x: number, y: number, extra: object = {}) =>
  event(type, {
    pointerId: id,
    pointerType: "touch",
    button: 0,
    clientX: x,
    clientY: y + 20,
    ...extra,
  });

const key = (type: string, k: string, code: string, extra: object = {}, target?: object) =>
  event(type, { key: k, code, ctrlKey: false, metaKey: false, altKey: false, ...extra }, target);

function setup() {
  const element = new FakeElement();
  const keyboard = new EventTarget();
  const camera = new FlatCamera({ width: 512, height: 256 });
  camera.resize(1200, 800);
  camera.zoomAt(4, 600, 400);
  const onTileClick = vi.fn<(tile: number) => void>();
  const onHover = vi.fn<(tile: number | undefined) => void>();
  const input = new InputController(
    element as unknown as HTMLElement,
    camera,
    { onTileClick, onHover },
    keyboard,
  );
  return { element, keyboard, camera, input, onTileClick, onHover };
}

describe("InputController", () => {
  it("clicks a tile in element coordinates and captures the pointer", () => {
    const { element, camera, onTileClick } = setup();
    element.dispatchEvent(pointer("pointerdown", 3, 310, 210));
    element.dispatchEvent(pointer("pointerup", 3, 310, 210));
    expect(onTileClick).toHaveBeenCalledExactlyOnceWith(camera.screenToTile(310, 210));
    expect(element.captured).toEqual([3]);
  });

  it("ignores right and middle mouse buttons, and survives a failed capture", () => {
    const { element, onTileClick } = setup();
    element.dispatchEvent(pointer("pointerdown", 1, 310, 210, { pointerType: "mouse", button: 2 }));
    element.dispatchEvent(pointer("pointerup", 1, 310, 210, { pointerType: "mouse", button: 2 }));
    element.dispatchEvent(pointer("pointerdown", -1, 310, 210, { pointerType: "pen" }));
    element.dispatchEvent(pointer("pointerup", -1, 310, 210, { pointerType: "pen" }));
    expect(onTileClick).toHaveBeenCalledOnce();
  });

  it("pans on drag, forgets cancelled pointers and reports hover", () => {
    const { element, camera, onTileClick, onHover } = setup();
    const pressed = camera.screenToTile(300, 300);
    element.dispatchEvent(pointer("pointerdown", 1, 300, 300));
    element.dispatchEvent(pointer("pointermove", 1, 400, 300));
    element.dispatchEvent(pointer("pointercancel", 1, 400, 300));
    element.dispatchEvent(pointer("pointerup", 1, 400, 300));
    expect(camera.view().centerX).toBeCloseTo(256 - 100 / camera.scale);
    expect(onTileClick).not.toHaveBeenCalled();
    element.dispatchEvent(pointer("pointermove", 9, 600, 400, { pointerType: "mouse" }));
    element.dispatchEvent(pointer("pointerleave", 9, 600, 400, { pointerType: "mouse" }));
    // The finger shows its tile until it drags; the mouse until it leaves.
    expect(onHover.mock.calls).toEqual([
      [pressed],
      [undefined],
      [camera.screenToTile(600, 400)],
      [undefined],
    ]);
  });

  it("zooms on the wheel at the cursor and keeps the page from zooming", () => {
    const { element, camera } = setup();
    const under = camera.screenToTile(903, 207);
    const wheel = event("wheel", { deltaY: -200, deltaMode: 0, clientX: 903, clientY: 227 });
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(camera.zoom).toBeGreaterThan(4);
    expect(camera.screenToTile(903, 207)).toBe(under);
  });

  it("pans with held keys on update and zooms with +", () => {
    const { keyboard, camera, input } = setup();
    const down = key("keydown", "ArrowDown", "ArrowDown");
    keyboard.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    input.update(100);
    expect(camera.view().centerY).toBeGreaterThan(128);
    keyboard.dispatchEvent(key("keyup", "ArrowDown", "ArrowDown"));
    keyboard.dispatchEvent(key("keydown", "+", "NumpadAdd"));
    expect(camera.zoom).toBeCloseTo(5);
  });

  it("leaves keys alone in text fields, with modifiers and for game commands", () => {
    const { keyboard, camera, input } = setup();
    keyboard.dispatchEvent(key("keydown", "d", "KeyD", {}, { tagName: "INPUT" }));
    keyboard.dispatchEvent(key("keydown", "-", "Minus", { ctrlKey: true }));
    const space = key("keydown", " ", "Space");
    keyboard.dispatchEvent(space);
    input.update(100);
    expect(space.defaultPrevented).toBe(false);
    expect(camera.view().centerX).toBe(256);
    expect(camera.zoom).toBe(4);
  });

  it("lets go of keys and pointers when the window loses focus", () => {
    const { element, keyboard, camera, input, onTileClick } = setup();
    keyboard.dispatchEvent(key("keydown", "d", "KeyD"));
    element.dispatchEvent(pointer("pointerdown", 1, 300, 300));
    keyboard.dispatchEvent(new Event("blur"));
    element.dispatchEvent(pointer("pointerup", 1, 300, 300));
    input.update(100);
    expect(camera.view().centerX).toBe(256);
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("stops listening once disposed", () => {
    const { element, keyboard, camera, input, onTileClick } = setup();
    keyboard.dispatchEvent(key("keydown", "d", "KeyD"));
    input.dispose();
    input.update(100);
    keyboard.dispatchEvent(key("keydown", "+", "NumpadAdd"));
    element.dispatchEvent(pointer("pointerdown", 1, 300, 300));
    element.dispatchEvent(pointer("pointerup", 1, 300, 300));
    expect(camera.view().centerX).toBe(256);
    expect(camera.zoom).toBe(4);
    expect(onTileClick).not.toHaveBeenCalled();
  });
});
