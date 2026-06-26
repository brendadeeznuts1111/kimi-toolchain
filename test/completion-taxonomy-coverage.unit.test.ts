import { describe, test, expect } from "bun:test";
import { buildTaxonomyCoverage } from "../src/completions/taxonomy-coverage";
import type { CompletionData } from "../src/completions/completion-matrix";

function makeData(overrides: Partial<CompletionData> = {}): CompletionData {
  return {
    version: "1.2.0",
    commands: {},
    globalFlags: [],
    bunGetCompletes: { available: false },
    specialHandling: {
      bareCommand: {
        description: "",
        canRunFiles: true,
        dynamicCompletions: { scripts: true, files: true, binaries: true },
      },
    },
    ...overrides,
  };
}

describe("completion-taxonomy-coverage", () => {
  test("reports 100% coverage when all flags are categorized", () => {
    const data = makeData({
      globalFlags: [
        { name: "outfile", hasValue: true },
        { name: "watch", hasValue: false },
      ],
      commands: {
        install: {
          name: "install",
          flags: [{ name: "frozen-lockfile", hasValue: false }],
          positionalArgs: [],
          examples: [],
        },
      },
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.totalFlags).toBe(3);
    expect(report.categorizedFlags).toBe(3);
    expect(report.uncategorizedFlags).toBe(0);
    expect(report.coveragePercent).toBe(100);
    expect(report.uncategorized).toEqual([]);
  });

  test("reports uncategorized flags", () => {
    const data = makeData({
      globalFlags: [{ name: "unknown-flag", hasValue: false }],
      commands: {},
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.totalFlags).toBe(1);
    expect(report.categorizedFlags).toBe(0);
    expect(report.uncategorizedFlags).toBe(1);
    expect(report.coveragePercent).toBe(0);
    expect(report.uncategorized).toEqual(["unknown-flag"]);
  });

  test("counts flags appearing in multiple categories once for coverage", () => {
    const data = makeData({
      globalFlags: [{ name: "cwd", hasValue: false }],
      commands: {},
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.totalFlags).toBe(1);
    expect(report.categorizedFlags).toBe(1);
    expect(report.coveragePercent).toBe(100);
    expect(report.byCategory.fileIO).toBeGreaterThanOrEqual(1);
    expect(report.byCategory.runtime).toBeGreaterThanOrEqual(1);
  });

  test("aggregates by category", () => {
    const data = makeData({
      globalFlags: [
        { name: "outfile", hasValue: true },
        { name: "registry", hasValue: true },
        { name: "unknown", hasValue: false },
      ],
      commands: {},
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.byCategory.fileIO).toBe(1);
    expect(report.byCategory.network).toBe(1);
    expect(report.byCategory.pm).toBe(1);
    expect(report.byCategory.uncategorized).toBe(1);
  });
});
