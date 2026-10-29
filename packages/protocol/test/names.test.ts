import { describe, expect, it } from "vitest";
import {
  MAX_GAME_NAME_LENGTH,
  MAX_NAME_LENGTH,
  nameKey,
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

  it("rejects staff names in disguise", () => {
    for (const name of [
      "Ａｄｍｉｎ", // full-width
      "Admín", // accent
      "Frontfаll", // Cyrillic а
      "аdmin", // Cyrillic а
      "МОD", // Cyrillic М and О
      "Adm1n",
      "AdmIn",
      "FrontfaII",
      "Sуstem", // Cyrillic у
    ]) {
      expect(normalizeName(name), name).toEqual({ ok: false, error: "this name is reserved" });
    }
  });

  it("rejects names that draw nothing", () => {
    for (const name of [
      "\u3164\u3164\u3164",
      "\u115f\u1160",
      "\uffa0",
      "\u2800\u2800",
      "Bob\u3164",
      "B\u034fob",
      "\u0301\u0301",
    ]) {
      expect(normalizeName(name).ok, JSON.stringify(name)).toBe(false);
    }
  });

  it("rejects stacks of accents", () => {
    expect(normalizeName("a" + "\u0301".repeat(19)).ok).toBe(false);
    expect(normalizeName("Bob" + "\u0300\u0301\u0302\u0303").ok).toBe(false);
  });

  it("keeps names of other languages, accents and all", () => {
    for (const name of [
      "Éloïse",
      "Борис",
      "Вова",
      "さくら",
      "محمد",
      "Nguyễn",
      "สมชาย",
      "กั้ง",
      "ज़ीं",
      "Ὀδυσσεύς",
      "Modeste",
      "Systemic",
    ]) {
      expect(normalizeName(name), name).toEqual({ ok: true, name: name.normalize("NFC") });
    }
  });
});

describe("nameKey", () => {
  it("takes names that look alike as one", () => {
    expect(nameKey("Вob")).toBe(nameKey("Bob")); // Cyrillic В
    expect(nameKey("Ｂｏｂ")).toBe(nameKey("bob"));
    expect(nameKey("Élodie-B.")).toBe(nameKey("elodie b"));
    expect(nameKey("BiII")).toBe(nameKey("Bill"));
    expect(nameKey("B0b")).toBe(nameKey("Bob"));
  });

  it("tells different names apart", () => {
    expect(nameKey("Bob 2")).not.toBe(nameKey("Bob 3"));
    expect(nameKey("Борис")).not.toBe(nameKey("Bob"));
    expect(nameKey("さくら")).not.toBe(nameKey("さくろ"));
    // Vowel signs and voicing marks are letters' sounds there, not accents.
    expect(nameKey("किरण")).not.toBe(nameKey("करण"));
    expect(nameKey("กั้ง")).not.toBe(nameKey("กง"));
    expect(nameKey("がな")).not.toBe(nameKey("かな"));
    expect(nameKey("Борис")).not.toBe("");
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
    for (const name of ["Classic match", "Scunthorpe", "Cockpit duel", "Shitake", "Salopette"]) {
      expect(normalizeGameName(name).ok, name).toBe(true);
    }
  });
});

describe("names shown to strangers", () => {
  it("catch plurals, look-alike letters and stems split by spaces", () => {
    for (const name of [
      "niggers",
      "fuckers",
      "sales putes",
      "f u ck",
      "fuсk you",
      "Encul3s",
      "enculé",
      "Les connardes",
      "salopes",
    ]) {
      expect(normalizeGameName(name).ok, name).toBe(false);
    }
  });

  it("apply to player names too, which the public list shows as hosts", () => {
    for (const name of ["casino.com", "www.spam.xyz", "nigger", "Putain"]) {
      expect(normalizeName(name).ok, name).toBe(false);
    }
    for (const name of ["Nico", "Léa", "Мария", "a.b-c", "Cassie"]) {
      expect(normalizeName(name).ok, name).toBe(true);
    }
  });
});
