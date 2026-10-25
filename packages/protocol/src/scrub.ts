/** Longest error message a report may carry. */
export const MAX_ERROR_MESSAGE = 120;

/**
 * An error message with what could point to a person taken out: addresses
 * and paths, anything quoted (where a player's name would be interpolated),
 * and numbers, which also lets identical errors read alike.
 */
export function scrubMessage(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<url>")
    .replace(/(?:^|\s)\/[^\s]+/g, " <path>")
    .replace(/(["'`«“‘]).*?(["'`»”’])/g, "<text>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE);
}
