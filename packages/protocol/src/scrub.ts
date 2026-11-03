/** Longest error message a report may carry. */
export const MAX_ERROR_MESSAGE = 120;

/** Longest input read; the result is cut far shorter anyway. */
const MAX_SCRUBBED_INPUT = 2000;

/**
 * An error message with what could point to a person taken out: addresses
 * and paths, anything quoted (where a player's name would be interpolated),
 * and numbers, which also lets identical errors read alike.
 */
export function scrubMessage(text: string): string {
  // Bounded first: the patterns below are only quadratic on very long input.
  return text
    .slice(0, MAX_SCRUBBED_INPUT)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<url>")
    .replace(/(?:^|\s)\/[^\s]+/g, " <path>")
    .replace(/(["'`«“‘]).*?(["'`»”’])/g, "<text>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE);
}
