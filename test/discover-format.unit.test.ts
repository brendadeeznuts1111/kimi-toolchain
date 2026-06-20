import { describe, expect, it } from "bun:test";
import { parseConstantRange } from "../src/lib/discover-constants.ts";
import {
  formatBoolStatus,
  formatConstantsSummary,
  formatConstantsTable,
  formatGapList,
  formatHealthScore,
  formatKvPairs,
  formatTextTable,
  formatUnifiedSummary,
} from "../src/lib/discover-format.ts";
import type { DiscoveredConstant } from "../src/lib/discover-constants.ts";

describe("discover-format", () => {
  it("should format aligned text tables", () => {
    const lines = formatTextTable({
      headers: ["KEY", "VALUE"],
      rows: [
        ["short", "1"],
        ["much-longer-key", "two"],
      ],
    });
    expect(lines[0]).toContain("KEY");
    expect(lines[0]).toContain("VALUE");
    expect(lines[1]).toMatch(/-+/);
    expect(lines[2]?.startsWith("short")).toBe(true);
  });

  it("should format health and status helpers", () => {
    expect(formatHealthScore(88)).toBe("88/100");
    expect(formatBoolStatus(true)).toBe("yes");
    expect(formatBoolStatus(false, "ok-fail")).toBe("FAIL");
  });

  it("should truncate gap lists with overflow marker", () => {
    const lines = formatGapList(["a", "b", "c"], { limit: 2 });
    expect(lines).toEqual(["  - a", "  - b", "  - ... +1 more"]);
  });

  it("should format constants table rows", () => {
    const sample: DiscoveredConstant = {
      key: "KIMI_X",
      domain: "demo",
      type: "number",
      value: 1,
      range: parseConstantRange("positive integer", "number"),
      sources: {},
      valid: true,
      validationIssues: [],
      usages: [],
      usageBreakdown: { src: ["src/lib/demo.ts"], test: [], scripts: [] },
      orphan: false,
      annotationsComplete: true,
      taxonomy: [],
      goldenDrift: false,
      seeResolved: [],
      literalDuplicateHits: [],
      suggestionMentions: [],
    };
    const lines = formatConstantsTable([sample]);
    expect(lines.some((line) => line.includes("KIMI_X"))).toBe(true);
    expect(lines.some((line) => line.includes("demo"))).toBe(true);
  });

  it("should format constants summary with manifestStale", () => {
    const lines = formatConstantsSummary({
      tuningSetVersion: "2026.06",
      constantCount: 25,
      validCount: 25,
      invalidCount: 0,
      orphanCount: 3,
      annotationGapCount: 0,
      goldenDriftCount: 0,
      manifestStale: true,
      healthScore: 66,
      domains: [],
      alignment: { definesWithoutTypes: [], typesWithoutDefines: [] },
      constants: [],
    });
    expect(lines[0]).toBe("health 66/100");
    expect(lines[1]).toContain("manifestStale=yes");
    expect(lines[1]).not.toContain("manifestStale=no");
  });

  it("should format kv pairs without undefined fields", () => {
    expect(formatKvPairs({ a: 1, b: undefined, c: "x" })).toBe("a=1  c=x");
  });

  it("should format unified summary lines", () => {
    const lines = formatUnifiedSummary({
      generatedAt: "2026-01-01T00:00:00.000Z",
      projectRoot: "/tmp",
      layers: ["all"],
      crossLinks: [],
      unifiedGaps: [],
      health: { overall: 70, constants: 80, dx: 60 },
    });
    expect(lines[0]).toContain("overall=70/100");
  });
});
