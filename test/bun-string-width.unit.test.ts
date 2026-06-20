/**
 * Bun.stringWidth grapheme breaking regression test.
 *
 * Bun v1.3.7 fixed GB9c Indic Conjunct Break — Devanagari conjuncts
 * now correctly form single grapheme clusters instead of being split.
 * Internal table size reduced from ~70KB to ~51KB.
 */
import { describe, expect, test } from "bun:test";

describe("bun-string-width", () => {
  test("Bun.stringWidth is available", () => {
    expect(typeof Bun.stringWidth).toBe("function");
  });

  test("plain ASCII string width equals length", () => {
    expect(Bun.stringWidth("hello")).toBe(5);
  });

  test("emoji counts as width 2", () => {
    expect(Bun.stringWidth("😀")).toBe(2);
  });

  test("zero-width joiner handled correctly", () => {
    expect(Bun.stringWidth("👨‍👩‍👧")).toBe(2);
  });

  test("Devanagari conjunct क्ष treated as single cluster (GB9c)", () => {
    expect(Bun.stringWidth("क्ष")).toBe(2);
  });

  test("Devanagari conjunct with ZWJ क्‍ष treated as single cluster", () => {
    expect(Bun.stringWidth("क्‍ष")).toBe(2);
  });

  test("Devanagari triple conjunct क्क्क treated as single cluster", () => {
    expect(Bun.stringWidth("क्क्क")).toBe(3);
  });
});
