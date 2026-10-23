import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, normalizeName } from "../src/names.ts";

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
