import { describe, expect, test } from "bun:test";
import {
  BUN_COLOR_STRING_FORMATS,
  buildColorConversionRows,
  COLOR_FORMAT_PROPERTIES,
  convertBunColor,
  isBunColorStringFormat,
  matchesColorFormat,
  verifyColorFormat,
} from "../src/lib/bun-color-formats.ts";

describe("bun-color-formats", () => {
  test("isBunColorStringFormat accepts hex HEX hsl only", () => {
    expect(isBunColorStringFormat("hex")).toBe(true);
    expect(isBunColorStringFormat("HEX")).toBe(true);
    expect(isBunColorStringFormat("hsl")).toBe(true);
    expect(isBunColorStringFormat("HSL")).toBe(false);
    expect(isBunColorStringFormat("ansi-256")).toBe(false);
  });

  test("property matchers for hex HEX hsl on #ff0000", () => {
    for (const format of BUN_COLOR_STRING_FORMATS) {
      const { ok, result } = verifyColorFormat("#ff0000", format);
      expect(ok).toBe(true);
      expect(result).toBe(COLOR_FORMAT_PROPERTIES[format].example);
      expect(matchesColorFormat(result, format)).toBe(true);
    }
  });

  test("hex vs HEX casing differs", () => {
    const hex = convertBunColor("#ff0000", "hex");
    const HEX = convertBunColor("#ff0000", "HEX");
    expect(hex).toBe("#ff0000");
    expect(HEX).toBe("#FF0000");
    expect(matchesColorFormat(hex, "hex")).toBe(true);
    expect(matchesColorFormat(HEX, "HEX")).toBe(true);
    expect(matchesColorFormat(hex, "HEX")).toBe(false);
  });

  test("HSL uppercase is rejected by Bun.color", () => {
    expect(() => Bun.color("#ff0000", "HSL" as "hsl")).toThrow();
  });

  test("buildColorConversionRows marks all property matches true", () => {
    const rows = buildColorConversionRows("#ff0000");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.propertyMatch).toBe(true);
      expect(row.result).not.toBeNull();
    }
  });
});
