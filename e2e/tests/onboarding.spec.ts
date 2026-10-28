import { expect, test } from "@playwright/test";

/** Starts a solo game on a small map, as a new player does. */
async function startSolo(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
}

test("the help lists every building with its key, cost and where it goes", async ({ page }) => {
  await startSolo(page);
  await expect(page.locator("#build-port .build-key").first()).toHaveText("O");
  // Costs come with the first update of the game.
  await expect(page.locator("#build-port .build-cost")).toHaveText(/\d/);

  await page.keyboard.press("Shift+Slash");
  const help = page.locator("#help-panel");
  await expect(help).toBeVisible();
  await expect(help).toContainText("How to play");
  const port = help.locator(".help-build.build-port");
  await expect(port).toContainText("on your coast");
  await expect(port.locator("kbd").first()).toHaveText("O");
  await expect(port.locator(".help-cost")).toHaveText(/\d/);
  // One row per build button.
  await expect(help.locator(".help-build")).toHaveCount(
    await page.locator(".build-button").count(),
  );

  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await page.keyboard.press("KeyH");
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Back to the game" }).click();
  await expect(help).toHaveCount(0);
});

test("the first steps follow the player, and stay hidden once put away", async ({ page }) => {
  await startSolo(page);
  const guide = page.locator("#guide");
  await expect(guide).toHaveAttribute("data-step", "start");
  await expect(guide).toContainText("choose where you start");

  // Next moves on without doing the step; the guide never blocks the game.
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "expand");
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "attack");
  await expect(guide).toContainText("Retreat");
  await page.locator("#guide-next").click();
  await page.locator("#guide-next").click();
  await expect(guide).toHaveAttribute("data-step", "defend");
  await expect(guide).toContainText("Fort");

  await page.locator("#guide-hide").click();
  await expect(guide).toHaveCount(0);
  await page.locator("#leave").click();
  await startSolo(page);
  await expect(page.locator("#hud")).toBeVisible();
  await expect(guide).toHaveCount(0);

  // The help brings them back.
  await page.locator("#help").click();
  await page.getByRole("button", { name: "Show the first steps again" }).click();
  await expect(guide).toHaveAttribute("data-step", "start");
});

test("a refused build names what was refused", async ({ page }) => {
  await startSolo(page);
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  // Water in a corner of the view: never a place for a city.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  await page.keyboard.press("KeyC");
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await expect(page.locator("#click-note")).toContainText(/^City: /);
});
