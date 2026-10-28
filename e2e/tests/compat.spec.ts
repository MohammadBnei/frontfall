import { expect, test, type Page } from "@playwright/test";

/** A browser that cannot create a WebGL 2 context, such as one with hardware acceleration off. */
async function withoutWebGL2(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === "webgl2" ? null : original.call(this, type, ...rest);
      };`,
  });
}

test("a browser without WebGL 2 is told so at once", async ({ page }) => {
  await withoutWebGL2(page);
  await page.goto("./");
  await expect(page.locator("#compat-notice")).toContainText("WebGL 2");
  await expect(page.locator("#play")).toBeVisible();
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the notice is read in French", async ({ page }) => {
    await withoutWebGL2(page);
    await page.goto("./");
    await expect(page.locator("#compat-notice")).toContainText("ne peut pas encore");
  });
});

test("a working browser sees no notice", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#play")).toBeVisible();
  await expect(page.locator("#compat-notice")).toHaveCount(0);
});
