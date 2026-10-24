import { expect, test } from "@playwright/test";

test("saves a finished game and watches it again to the same end (#50)", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // A one-minute game at thirty ticks per beat: over in seconds.
  await page.goto("./?map=island&bots=3&difficulty=normal&nations=0&speed=30&minutes=1");
  await page.locator("#play").click();
  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 120_000 });

  const saved = page.waitForEvent("download");
  await end.getByRole("button", { name: "Save the replay" }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toMatch(/^frontfall-island-\d{4}-\d{2}-\d{2}\.ffr$/);
  const path = await download.path();

  await end.getByRole("button", { name: "Main menu" }).click();
  await page.locator("#replay-file").setInputFiles(path);
  const bar = page.locator("#replay-bar");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  // No orders while watching: the build panel and the attack ratio are gone.
  await expect(page.locator(".panel.build")).toBeHidden();
  await bar.getByRole("button", { name: "×8" }).click();
  await expect(bar.getByRole("button", { name: "×8" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator(".replay-result")).toHaveText("Same end as the game", {
    timeout: 120_000,
  });
  // At the end of the record, which runs on past the win until it was saved.
  await expect(bar.locator(".replay-time")).toHaveText(/^(\d+:\d\d) \/ \1$/);
  await expect(page.locator(".end-screen")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test("refuses a file that is not a replay", async ({ page }) => {
  await page.goto("./");
  await page.locator("#replay-file").setInputFiles({
    name: "notes.ffr",
    mimeType: "application/gzip",
    buffer: Buffer.from("not a replay"),
  });
  await expect(page.locator(".notice")).toHaveText("This file is not a Frontfall replay.");
  await expect(page.locator("#menu")).toBeVisible();
});
