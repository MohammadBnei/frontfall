import { t } from "../../i18n/index.ts";

/**
 * The one dialog over a game at a time (help, pause, end screen) and the
 * pause that goes with it: closing the dialog resumes a game it paused, and
 * gives the keyboard back to the map.
 */
export class Overlays {
  private current: HTMLElement | undefined;
  private pausedNow = false;

  constructor(
    /** Where the dialogs go: the game's own element. */
    private readonly parent: HTMLElement,
    /** The map, focused again once a dialog closes. */
    private readonly surface: HTMLElement,
    /** Stops or resumes the game's clock. */
    private readonly setPaused: (paused: boolean) => void,
  ) {}

  /** Whether a dialog is showing. */
  get open(): boolean {
    return this.current !== undefined;
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  /** Stops the game until the dialog shown next closes. */
  pause(): void {
    this.pausedNow = true;
    this.setPaused(true);
  }

  /** Pauses the game behind a banner that resumes it when clicked. */
  showPause(): void {
    this.pause();
    const banner = document.createElement("div");
    banner.className = "overlay paused";
    const text = document.createElement("p");
    text.className = "paused-text";
    text.textContent = t("hud.paused");
    banner.append(text);
    banner.addEventListener("click", () => {
      this.close();
    });
    this.show(banner);
  }

  show(element: HTMLElement): void {
    this.current?.remove();
    this.current = element;
    this.parent.append(element);
    // The main action, so that Enter never casts a vote by accident; a long
    // dialog still opens at its top, even when that button is at the foot.
    (
      element.querySelector<HTMLElement>("button.primary") ?? element.querySelector("button")
    )?.focus({ preventScroll: true });
  }

  close(): void {
    this.current?.remove();
    this.current = undefined;
    if (this.pausedNow) {
      this.pausedNow = false;
      this.setPaused(false);
    }
    this.surface.focus();
  }
}
