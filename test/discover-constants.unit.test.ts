import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  discoverConstants,
  formatConstantRange,
  parseConstantRange,
} from "../src/lib/discover-constants.ts";
import {
  parseBuildConstantsTypes,
  parseTypeExpression,
} from "../src/lib/build-constants-registry.ts";

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

  it("should parse union literal type expressions", () => {
    expect(parseTypeExpression('"strict" | "gradual" | "off"')).toMatchObject({
      type: "string",
      enumValues: ["strict", "gradual", "off"],
    });
  });

  it("should discover constants with validation, usages, and taxonomy metadata", async () => {
    const root = join(import.meta.dir, "..");
    const report = await discoverConstants(root);
    expect(report.constantCount).toBeGreaterThan(20);
    expect(report.validCount).toBe(report.constantCount);
    expect(report.invalidCount).toBe(0);
    expect(report.domains.length).toBeGreaterThan(8);
    expect(report.alignment.definesWithoutTypes).toEqual([]);
    expect(report.alignment.typesWithoutDefines).toEqual([]);
    expect(typeof report.manifestStale).toBe("boolean");
    expect(report.healthScore).toBeGreaterThan(0);

    const purity = report.constants.find((entry) => entry.key === "KIMI_DOMAIN_PURITY_LEVEL");
    expect(purity?.range.values).toEqual(["strict", "gradual", "off"]);
    expect(purity?.valid).toBe(true);
    expect(purity?.usageBreakdown.src.length).toBeGreaterThan(0);
    expect(purity?.orphan).toBe(false);

    const windowDays = report.constants.find(
      (entry) => entry.key === "KIMI_DECISION_SCORE_WINDOW_DAYS"
    );
    expect(windowDays?.parity?.id).toBe("velocity-window-days");
    expect(windowDays?.usages.length).toBeGreaterThan(0);
    expect(windowDays?.sources.bunfigLine).toBeGreaterThan(0);
    expect(windowDays?.sources.typesLine).toBeGreaterThan(0);
    expect(windowDays?.seeResolved.every((ref) => ref.exists)).toBe(true);

    const hookCycles = report.constants.find(
      (entry) => entry.key === "KIMI_HOOK_VERIFIER_MAX_CYCLES"
    );
    expect(hookCycles?.taxonomy.length).toBeGreaterThan(0);
    expect(hookCycles?.taxonomy[0]?.id).toBeTruthy();
  });

  it("should parse union types from build-constants.d.ts", async () => {
    const root = join(import.meta.dir, "..");
    const typesText = await Bun.file(join(root, "types/build-constants.d.ts")).text();
    const types = parseBuildConstantsTypes(typesText);
    expect(types.get("KIMI_DOMAIN_PURITY_LEVEL")).toMatchObject({
      type: "string",
      enumValues: ["strict", "gradual", "off"],
      restrictions: "one of strict | gradual | off",
    });
  });
});
