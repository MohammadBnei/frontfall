import { getLanguage } from "../i18n/index.ts";

/** 950, 12.4K, 3.1M: short enough for the HUD, in the reader's language. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat(getLanguage(), {
    notation: value < 10_000 ? "standard" : "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(share: number): string {
  return new Intl.NumberFormat(getLanguage(), {
    style: "percent",
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  }).format(share);
}

/** Game time as m:ss, or h:mm:ss past an hour. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${s}` : `${String(m)}:${s}`;
}
