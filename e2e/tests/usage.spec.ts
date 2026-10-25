import { expect, test } from "@playwright/test";

test("reports a finished game and the player's thumbs down, without a name", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const reports: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/api/usage")) {
      reports.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
    }
  });

  // ?usage: a test tool's page reports only when asked to.
  await page.goto("./?usage&map=island&bots=3&difficulty=normal&nations=0&speed=30&minutes=1");
  await page.locator("#player-name").fill("Secret Name");
  await page.locator("#play").click();
  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => reports.some((report) => report.kind === "game")).toBe(true);
  const game = reports.find((report) => report.kind === "game");
  expect(game).toMatchObject({ mode: "solo", map: "island", bots: 3, device: "desktop" });
  expect(["victory", "defeat"]).toContain(game?.outcome);

  const feedback = end.locator("#feedback");
  await expect(feedback).toContainText("Did you enjoy this game?");
  await expect(feedback.getByRole("link", { name: "Share an idea" })).toHaveAttribute(
    "href",
    "https://github.com/nic0lasm/frontfall/discussions/new?category=frontfall-ideas",
  );
  await expect(feedback.getByRole("link", { name: "Report a bug" })).toHaveAttribute(
    "href",
    /issues\/new\?template=bug\.yml&version=/,
  );
  await feedback.getByRole("button", { name: "I did not like it" }).click();
  await feedback.getByRole("button", { name: "Too hard" }).click();
  await expect(feedback).toContainText("Thanks!");
  await expect.poll(() => reports.some((report) => report.kind === "feedback")).toBe(true);
  expect(reports.find((report) => report.kind === "feedback")).toMatchObject({
    vote: "down",
    reason: "too_hard",
    game: game?.game,
  });

  // Leaving afterwards reports nothing more about the same game.
  await end.getByRole("button", { name: "Main menu" }).click();
  await expect(page.locator("#menu")).toBeVisible();
  expect(reports.filter((report) => report.kind === "game")).toHaveLength(1);
  expect(JSON.stringify(reports)).not.toContain("Secret Name");

  const stats = (await (await page.request.get("./api/stats")).json()) as {
    total: Record<string, Record<string, number>>;
  };
  expect(stats.total.reasons?.too_hard).toBeGreaterThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});

test("sends nothing from a page driven by a test tool", async ({ page }) => {
  const reports: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/api/usage")) reports.push(request.url());
  });
  await page.goto("./?map=skirmish&bots=2");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await page.goto("./");
  await expect(page.locator("#menu")).toBeVisible();
  expect(reports).toEqual([]);
});
