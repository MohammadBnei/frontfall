import type { MessageKey } from "../i18n/index.ts";
import { RELEASE } from "../release.ts";
import { h } from "./dom.ts";

const REPOSITORY = "https://github.com/nic0lasm/frontfall";

/**
 * Where players share ideas: the "Frontfall Ideas" category of the
 * Discussions. Should it go away, GitHub asks for another category instead.
 */
export const IDEAS_URL = `${REPOSITORY}/discussions/new?category=frontfall-ideas`;

/** The bug form, with the release and what the game was already filled in. */
export function bugUrl(details = ""): string {
  const query = new URLSearchParams({
    template: "bug.yml",
    version: details ? `${RELEASE} (${details})` : RELEASE,
  });
  return `${REPOSITORY}/issues/new?${query.toString()}`;
}

/** The two links, to GitHub, in a new tab. */
export function feedbackLinks(details = ""): HTMLElement {
  const link = (key: MessageKey, href: string): HTMLAnchorElement =>
    h("a", { href, target: "_blank", rel: "noopener", "data-i18n": key });
  return h(
    "p",
    { class: "feedback-links" },
    link("feedback.idea", IDEAS_URL),
    " · ",
    link("feedback.bug", bugUrl(details)),
  );
}
