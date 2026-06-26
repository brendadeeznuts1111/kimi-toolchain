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
    expect(report.uniqueFlags).toBe(3);
    expect(report.uniqueCategorizedFlags).toBe(3);
    expect(report.uniqueUncategorizedFlags).toBe(0);
    expect(report.uniqueCoveragePercent).toBe(100);
    expect(report.byOS).toBeDefined();
    expect(report.byOS.total).toBe(0);
    expect(report.byOS.unique).toBe(0);
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

  test("category distribution tracks unique flags", () => {
    const data = makeData({
      globalFlags: [{ name: "cwd", hasValue: false }],
      commands: {
        build: {
          name: "build",
          flags: [{ name: "cwd", hasValue: false }],
          positionalArgs: [],
          examples: [],
        },
      },
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.uniqueFlags).toBe(1);
    expect(report.categoryDistribution.fileIO.total).toBe(2);
    expect(report.categoryDistribution.fileIO.unique).toBe(1);
    expect(report.categoryDistribution.runtime.total).toBe(2);
    expect(report.categoryDistribution.runtime.unique).toBe(1);
  });

  test("command breakdown summarizes per-command coverage", () => {
    const data = makeData({
      globalFlags: [],
      commands: {
        install: {
          name: "install",
          flags: [
            { name: "frozen-lockfile", hasValue: false },
            { name: "unknown-install-flag", hasValue: false },
          ],
          positionalArgs: [],
          examples: [],
        },
      },
    });

    const report = buildTaxonomyCoverage(data);
    const install = report.commandBreakdown.find((c) => c.command === "install")!;
    expect(install.totalFlags).toBe(2);
    expect(install.categorizedFlags).toBe(1);
    expect(install.uncategorizedFlags).toBe(1);
    expect(install.coveragePercent).toBe(50);
    expect(install.byCategory.pm).toBe(1);
    expect(install.byCategory.uncategorized).toBe(1);
  });

  test("multi-category flags are reported with their categories", () => {
    const data = makeData({
      globalFlags: [{ name: "cwd", hasValue: false }],
      commands: {},
    });

    const report = buildTaxonomyCoverage(data);
    const entry = report.multiCategoryFlags.find((m) => m.flag === "cwd")!;
    expect(entry).toBeDefined();
    expect(entry.categories).toContain("fileIO");
    expect(entry.categories).toContain("runtime");
  });

  test("occurrence histogram lists shared flags", () => {
    const data = makeData({
      globalFlags: [{ name: "cwd", hasValue: false }],
      commands: {
        run: {
          name: "run",
          flags: [{ name: "cwd", hasValue: false }],
          positionalArgs: [],
          examples: [],
        },
      },
    });

    const report = buildTaxonomyCoverage(data);
    const entry = report.occurrenceHistogram.find((o) => o.flag === "cwd")!;
    expect(entry).toBeDefined();
    expect(entry.occurrences).toBe(2);
    expect(entry.commands).toContain("(global)");
    expect(entry.commands).toContain("run");
  });

  test("byOS counts windows and posix flags", () => {
    const data = makeData({
      globalFlags: [
        { name: "windows-title", hasValue: true },
        { name: "no-orphans", hasValue: false },
      ],
      commands: {},
    });

    const report = buildTaxonomyCoverage(data);
    expect(report.byOS.windows).toBe(1);
    expect(report.byOS.posix).toBe(1);
    expect(report.byOS.total).toBe(2);
    expect(report.byOS.unique).toBe(2);
  });
});
