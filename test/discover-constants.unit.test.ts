import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  discoverConstants,
  formatConstantRange,
  parseConstantRange,
} from "../scripts/discover-constants.ts";

describe("discover-constants", () => {
  it("should parse closed numeric ranges from restrictions", () => {
    const range = parseConstantRange(
      "reserved — cluster merge threshold in [0, 1] (Phase 2)",
      "number"
    );
    expect(range).toMatchObject({ kind: "closed", min: 0, max: 1 });
    expect(formatConstantRange(range)).toBe("[0, 1]");
  });

  it("should parse enum and min-bound restrictions", () => {
    const enumRange = parseConstantRange("one of strict | gradual | off", "string");
    expect(enumRange.values).toEqual(["strict", "gradual", "off"]);
    expect(formatConstantRange(enumRange)).toBe("strict | gradual | off");

    const minRange = parseConstantRange("multiplier >= 1.0 — trained threshold margin", "number");
    expect(minRange).toMatchObject({ kind: "min", min: 1 });
    expect(formatConstantRange(minRange)).toBe("≥ 1");
  });

  it("should discover all repo define constants", async () => {
    const root = join(import.meta.dir, "..");
    const constants = await discoverConstants(root);
    expect(constants.length).toBeGreaterThan(20);
    expect(constants.some((entry) => entry.key === "KIMI_TUNING_SET_VERSION")).toBe(true);
    expect(
      constants.every((entry) => entry.domain && entry.type && entry.value !== undefined)
    ).toBe(true);
  });
});
