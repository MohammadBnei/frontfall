import type { FeedbackReason } from "@frontfall/protocol";
import { applyTranslations, type MessageKey } from "../i18n/index.ts";
import { RELEASE } from "../release.ts";
import type { GameTracker } from "../usage.ts";
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

const REASONS: readonly FeedbackReason[] = ["too_hard", "too_long", "unclear", "slow_or_buggy"];

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

/**
 * A thumbs up or down on the game just played, counted without saying who
 * gave it; a thumbs down may add one reason from a fixed list.
 */
export function feedbackBlock(tracker: GameTracker, details: string): HTMLElement {
  const question = h("p", { class: "feedback-question", "data-i18n": "feedback.question" });
  const thanks = h("p", { class: "feedback-thanks", "data-i18n": "feedback.thanks", hidden: true });
  const button = (key: MessageKey, label: string, onClick: () => void): HTMLButtonElement => {
    const element = h(
      "button",
      { type: "button", class: "secondary", "data-i18n-attr": `aria-label:${key}` },
      label,
    );
    element.addEventListener("click", onClick);
    return element;
  };
  const reasons = h("div", { class: "feedback-reasons", hidden: true });
  const thumbs = h("div", { class: "feedback-thumbs" });
  const done = (): void => {
    thumbs.hidden = true;
    reasons.hidden = true;
    question.hidden = true;
    thanks.hidden = false;
  };
  const send = (vote: "up" | "down", reason?: FeedbackReason): void => {
    tracker.vote(vote, reason);
    done();
  };
  thumbs.append(
    button("feedback.up", "👍", () => {
      send("up");
    }),
    button("feedback.down", "👎", () => {
      thumbs.hidden = true;
      question.dataset.i18n = "feedback.why";
      applyTranslations(block);
      reasons.hidden = false;
      reasons.querySelector("button")?.focus();
    }),
  );
  for (const reason of REASONS) {
    const choice = h("button", {
      type: "button",
      class: "secondary",
      "data-i18n": `feedback.reason.${reason}`,
    });
    choice.addEventListener("click", () => {
      send("down", reason);
    });
    reasons.append(choice);
  }
  const plain = h("button", { type: "button", class: "link", "data-i18n": "feedback.noReason" });
  plain.addEventListener("click", () => {
    send("down");
  });
  reasons.append(plain);
  const block = h(
    "div",
    { class: "feedback", id: "feedback" },
    question,
    thumbs,
    reasons,
    thanks,
    feedbackLinks(details),
  );
  applyTranslations(block);
  return block;
}
