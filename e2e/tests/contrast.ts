import type { Page } from "@playwright/test";

/** A piece of text that falls short of the contrast it needs (WCAG 1.4.3). */
export interface Shortfall {
  text: string;
  selector: string;
  /** Contrast against the worst tenth of the pixels behind the text. */
  ratio: number;
  needed: number;
}

interface TextBox {
  text: string;
  selector: string;
  color: string;
  opacity: number;
  rect: [number, number, number, number];
  large: boolean;
}

/**
 * Measures the contrast of every text on screen, gradients, translucent panels and the map behind
 * them included, which an engine that reads CSS colours cannot do: the page is photographed with
 * its text made transparent, and each text is compared with the pixels it covers (the tenth
 * with the least contrast, so that a text half over a bright patch fails).
 */
export async function lowContrast(page: Page): Promise<Shortfall[]> {
  const boxes = await page.evaluate((): TextBox[] => {
    const found: TextBox[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest("script, style, noscript")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      let opacity = 1;
      for (let up: Element | null = element; up; up = up.parentElement) {
        opacity *= Number.parseFloat(getComputedStyle(up).opacity);
      }
      if (opacity === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight) {
        continue;
      }
      // Hidden behind something else, such as a dialog over the page: not read, not counted.
      const top = document.elementFromPoint(
        Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
        Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
      );
      if (!top || !(element.contains(top) || top.contains(element))) continue;
      const size = Number.parseFloat(style.fontSize);
      const bold = Number.parseInt(style.fontWeight, 10) >= 700;
      found.push({
        text: text.slice(0, 40),
        selector: `${element.tagName.toLowerCase()}${
          typeof element.className === "string" && element.className
            ? `.${element.className.split(" ")[0] ?? ""}`
            : ""
        }`,
        color: style.color,
        opacity,
        rect: [rect.left, rect.top, rect.width, rect.height],
        large: size >= 24 || (size >= 18.66 && bold),
      });
    }
    return found;
  });

  // The page is photographed with its text made transparent, then put back. A constructed
  // stylesheet gets past the page's content security policy, which a style element would not.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      "*{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important;caret-color:transparent !important}",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const photo = (await page.screenshot()).toString("base64");
  await page.evaluate(() => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.slice(0, -1);
  });

  return page.evaluate(
    async ({ boxes, photo }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${photo}`;
      await image.decode();
      const scale = image.width / innerWidth;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no 2D canvas to read the page");
      context.drawImage(image, 0, 0);
      const light = (channels: number[]): number => {
        const [r = 0, g = 0, b = 0] = channels.map((value) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const short: Shortfall[] = [];
      for (const box of boxes) {
        const [x = 0, y = 0, w = 0, h = 0] = box.rect.map((value) => value * scale);
        const left = Math.max(0, Math.floor(x));
        const top = Math.max(0, Math.floor(y));
        const width = Math.max(1, Math.min(image.width - left, Math.ceil(w)));
        const height = Math.max(1, Math.min(image.height - top, Math.ceil(h)));
        const pixels = context.getImageData(left, top, width, height).data;
        const [cr = 0, cg = 0, cb = 0, ca = 1] = (box.color.match(/[\d.]+/g) ?? []).map(Number);
        const alpha = ca * box.opacity;
        const stride = 4 * Math.max(1, Math.floor(pixels.length / 4 / 400));
        const ratios: number[] = [];
        for (let i = 0; i < pixels.length; i += stride) {
          const behind = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
          const ink = [cr, cg, cb].map(
            (value, c) => value * alpha + (behind[c] ?? 0) * (1 - alpha),
          );
          const a = light(ink);
          const b = light(behind);
          ratios.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
        }
        ratios.sort((p, q) => p - q);
        const ratio = ratios[Math.floor(ratios.length * 0.1)] ?? 21;
        const needed = box.large ? 3 : 4.5;
        if (ratio < needed) {
          short.push({
            text: box.text,
            selector: box.selector,
            ratio: Math.round(ratio * 100) / 100,
            needed,
          });
        }
      }
      return short;
    },
    { boxes, photo },
  );
}
