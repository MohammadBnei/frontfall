import { describe, expect, it } from "vitest";
import {
  MAX_GAME_NAME_LENGTH,
  MAX_NAME_LENGTH,
  normalizeGameName,
  normalizeName,
} from "../src/names.ts";

describe("normalizeName", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeName("  Jean   Luc ")).toEqual({ ok: true, name: "Jean Luc" });
  });

  it("accepts letters of any script and a few separators", () => {
    for (const name of ["Léa", "Zoë_2", "O'Brien", "Мария", "東京", "a.b-c"]) {
      expect(normalizeName(name)).toEqual({ ok: true, name });
    }
  });

  it("composes accents so the length counts what players see", () => {
    expect(normalizeName("Léa")).toEqual({ ok: true, name: "Léa" });
  });

  it("limits the length in characters", () => {
    expect(normalizeName("é".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(normalizeName("é".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("rejects empty names, symbols and markup", () => {
    for (const name of ["", "   ", "<script>", "a\u0000b", "-dash", "‮evil", "hi!"]) {
      expect(normalizeName(name).ok).toBe(false);
    }
  });

  it("rejects names that impersonate the staff", () => {
    for (const name of ["Admin", "a-d-m-i-n", "Frontfall", "SERVER"]) {
      expect(normalizeName(name)).toEqual({ ok: false, error: "this name is reserved" });
    }
  });
});

describe("normalizeGameName", () => {
  it("trims, collapses spaces and keeps a little punctuation", () => {
    expect(normalizeGameName("  4v4   Europe! ")).toEqual({ ok: true, name: "4v4 Europe!" });
    for (const name of ["Partie de Léa", "Teams (2) & friends", "Tous contre l'Ouest?", "#1"]) {
      expect(normalizeGameName(name).ok).toBe(name.length >= 3);
    }
  });

  it("asks for 3 to 32 characters", () => {
    expect(normalizeGameName("ab").ok).toBe(false);
    expect(normalizeGameName("abc").ok).toBe(true);
    expect(normalizeGameName("é".repeat(MAX_GAME_NAME_LENGTH)).ok).toBe(true);
    expect(normalizeGameName("é".repeat(MAX_GAME_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("turns away markup and web addresses", () => {
    for (const name of [
      "<b>hi</b>",
      "join example.com",
      "www.frontfall-cheats",
      "https://x.io",
      "play at site.gg now",
    ]) {
      expect(normalizeGameName(name).ok, name).toBe(false);
    }
  });

  it("turns away coarse words, accents, digits and spacing aside", () => {
    for (const name of ["fuck this", "Partie de connard", "Enculé", "sh1t game", "p u t e"]) {
      expect(normalizeGameName(name).ok, name).toBe(false);
    }
  });

  it("does not flag words that merely contain one", () => {
    for (const name of ["Classic match", "Scunthorpe", "Cockpit duel", "Shitake"]) {
      expect(normalizeGameName(name).ok, name).toBe(true);
    }
  });
});
