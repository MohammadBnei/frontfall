import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { lowContrast } from "./contrast.ts";

// These look at the picture itself: the full map, not the flat one the other specs use.
test.use({ storageState: { cookies: [], origins: [] } });

const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const GAME = "./?map=skirmish&bots=3&nations=0&difficulty=easy";
const SHORT_GAME = "./?map=island&bots=3&difficulty=normal&nations=0&speed=30&minutes=1";

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "root",
    "an audit of the page, once",
  );
});

/** Axe's findings under the WCAG 2.2 AA rules, one line each. */
async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(RULES).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

async function startGame(page: Page): Promise<void> {
  await page.goto(GAME);
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".banner")).toContainText("choose where you start");
}

/** What a finger can miss: a visible control under 44 px in either direction. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const small: string[] = [];
    const selector =
      "a[href], button, input, select, summary, [role=button], [tabindex]:not([tabindex='-1'])";
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest("[inert], [hidden]") || (element as HTMLInputElement).disabled) continue;
      // A small box is hit through its label, which takes the press too.
      const label = (element as HTMLInputElement).labels?.[0];
      const box = (
        label && element.matches("input[type=radio], input[type=checkbox]") ? label : element
      ).getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box.width === 0 || box.height === 0 || style.visibility === "hidden") continue;
      if (Math.round(box.width) < 44 || Math.round(box.height) < 44) {
        small.push(
          `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""} ${String(
            Math.round(box.width),
          )}x${String(Math.round(box.height))}`,
        );
      }
    }
    return small;
  });
}

test.describe("menu", () => {
  for (const locale of ["en-US", "fr-FR"]) {
    test(`has no WCAG 2.2 AA violation, with the settings open and in high contrast (${locale})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await page.goto("./");
      await expect(page.locator("#menu")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await lowContrast(page)).toEqual([]);

      await page.locator("#open-accessibility").click();
      await page.locator("#high-contrast").check();
      expect(await violations(page)).toEqual([]);
      expect(await lowContrast(page)).toEqual([]);
      await context.close();
    });
  }

  test("gives every control a visible focus, in an order that follows the screen", async ({
    page,
  }) => {
    await page.goto("./");
    await expect(page.locator("#play")).toBeFocused();
    const seen = new Set<string>();
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return undefined;
        const style = getComputedStyle(element);
        return {
          name: `${element.tagName.toLowerCase()}#${element.id}`,
          ring: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
          box: element.getBoundingClientRect().toJSON() as { top: number; bottom: number },
        };
      });
      if (!focus) continue;
      seen.add(focus.name);
      expect(focus.ring, `${focus.name} shows where the keyboard is`).toBe(true);
      expect(focus.box.bottom, `${focus.name} is on screen or scrolled to`).toBeGreaterThan(-1);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  test("is made of controls a finger can hit on a phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("./");
    await expect(page.locator("#menu")).toBeVisible();
    await page.locator("#open-accessibility").click();
    expect(await smallTargets(page)).toEqual([]);
    await context.close();
  });

  test("fits a screen magnified to 200 %, with nothing to scroll sideways", async ({ browser }) => {
    for (const viewport of [
      { width: 640, height: 400 },
      { width: 195, height: 422 },
    ]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto("./");
      await expect(page.locator("#menu")).toBeVisible();
      const [scrollWidth, innerWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      await expect(page.locator("#play")).toBeVisible();
      await context.close();
    }
  });
});

test.describe("game", () => {
  test("has no WCAG 2.2 AA violation and readable text, in the game and its help", async ({
    page,
  }) => {
    await startGame(page);
    // Axe cannot read a gradient: the text of the panels is measured from a photograph of the page.
    expect(await violations(page)).toEqual([]);
    expect(await lowContrast(page)).toEqual([]);

    await page.keyboard.press("h");
    await expect(page.locator("#help")).toBeVisible();
    expect(await violations(page)).toEqual([]);
    expect(await lowContrast(page)).toEqual([]);
  });

  test("is made of controls a finger can hit on a phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await startGame(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.locator("#build-toggle").click();
    expect(await smallTargets(page)).toEqual([]);
    await context.close();
  });

  test("shows no moving thing when motion is reduced, whether the system or the player asks", async ({
    browser,
  }) => {
    const running = (page: Page): Promise<number> =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === "running").length,
      );
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await startGame(page);
    await page.waitForTimeout(500);
    expect(await running(page)).toBe(0);
    await context.close();

    const own = await browser.newContext({ reducedMotion: "no-preference" });
    const second = await own.newPage();
    await second.goto("./");
    await second.locator("#open-accessibility").click();
    await second.locator("#reduce-motion").check();
    await second.locator("#play").click();
    await expect(second.locator("#map")).toBeVisible();
    await second.waitForTimeout(500);
    expect(await running(second)).toBe(0);
    await own.close();
  });

  test("keeps the keyboard and the screen reader inside the end screen", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(SHORT_GAME);
    await page.locator("#play").click();
    const end = page.locator(".end-screen");
    await expect(end).toBeVisible({ timeout: 120_000 });

    // A dialog with a name, whose main button has the focus, with nothing else reachable behind it.
    await expect(end).toHaveAttribute("role", "dialog");
    await expect(end).toHaveAttribute("aria-modal", "true");
    await expect(end).toHaveAccessibleName(/Victory|Defeat/);
    await expect(end.locator("button.primary")).toBeFocused();
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest(".end-screen") !== null,
      );
      const body = await page.evaluate(() => document.activeElement === document.body);
      expect(inside || body, "focus never goes behind the end screen").toBe(true);
    }

    expect(await violations(page)).toEqual([]);
    expect(await lowContrast(page)).toEqual([]);

    await end.getByRole("button", { name: "Keep watching" }).click();
    await expect(page.locator("#map")).toBeFocused();
  });
});
