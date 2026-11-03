import { describe, expect, it, vi } from "vitest";
import {
  fullscreenAvailable,
  fullscreenLabelKey,
  toggleFullscreen,
  type FullscreenHost,
} from "../src/ui/fullscreen.ts";

function host() {
  const request = vi.fn(() => {
    fake.on = true;
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    fake.on = false;
    return Promise.resolve();
  });
  const fake: FullscreenHost & { on: boolean } = {
    on: false,
    fullscreenEnabled: true,
    get fullscreenElement(): Element | null {
      return fake.on ? ({} as Element) : null;
    },
    documentElement: { requestFullscreen: request },
    exitFullscreen: exit,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { fake, request, exit };
}

describe("full screen", () => {
  it("is offered only where the browser has the Fullscreen API", () => {
    expect(fullscreenAvailable({ fullscreenEnabled: true })).toBe(true);
    expect(fullscreenAvailable({ fullscreenEnabled: false })).toBe(false);
    // An old browser: the property is missing altogether.
    expect(fullscreenAvailable({})).toBe(false);
  });

  it("enters full screen, then leaves it", async () => {
    const { fake, request, exit } = host();
    await toggleFullscreen(fake);
    expect(request).toHaveBeenCalledOnce();
    expect(fake.on).toBe(true);
    await toggleFullscreen(fake);
    expect(exit).toHaveBeenCalledOnce();
    expect(fake.on).toBe(false);
  });

  it("leaves things as they were when the browser refuses", async () => {
    const { fake, request } = host();
    request.mockImplementation(() => Promise.reject(new Error("denied")));
    await expect(toggleFullscreen(fake)).resolves.toBeUndefined();
    expect(fake.on).toBe(false);
  });

  it("names the action the next press does", () => {
    expect(fullscreenLabelKey(false)).toBe("fullscreen.enter");
    expect(fullscreenLabelKey(true)).toBe("fullscreen.exit");
  });
});
