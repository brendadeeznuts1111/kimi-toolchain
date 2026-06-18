import { describe, expect, test } from "bun:test";
import {
  evaluate,
  extractSection,
  parseLargestModules,
  parseQuickSummary,
  runBundleGate,
  type BundleGateReport,
  type BundleModuleRow,
  type BundleQuickSummary,
} from "../src/lib/bundle-gate.ts";

// ── Helpers ────────────────────────────────────────────────────────

const SAMPLE_REPORT = `# Bundle Analysis Report

## Quick Summary

| Metric | Value |
|--------|-------|
| Total output size | 10.51 MB |
| Input modules | 351 |
| Entry points | 1 |
| node_modules contribution | 192 files (9.80 MB) |
| ESM modules | 350 |
| CommonJS modules | 1 |
| External imports | 275 |

## Largest Modules by Output Contribution

| Output Bytes | % of Total | Module | Format |
|--------------|------------|--------|--------|
| 8.82 MB | 84.0% | \`typescript/lib/typescript.js\` | cjs |
| 161.43 KB | 1.5% | \`effect/dist/esm/Schema.js\` | esm |
| 105.84 KB | 1.0% | \`js-yaml/dist/js-yaml.mjs\` | esm |
| 66.0 KB | 0.6% | \`effect/dist/esm/internal/fiberRuntime.js\` | esm |
| 54.94 KB | 0.5% | \`src/bin/kimi-doctor.ts\` | esm |

*...and 346 more modules with output contribution*

## Other Section

Some content here.
`;

// ── extractSection ──────────────────────────────────────────────────

describe("bundle-gate parse", () => {
  test("extractSection finds Quick Summary", () => {
    const section = extractSection(SAMPLE_REPORT, "Quick Summary");
    expect(section).toContain("| Metric | Value |");
    expect(section).toContain("Total output size");
    expect(section).toContain("10.51 MB");
    expect(section).not.toContain("Largest Modules");
  });

  test("extractSection finds Largest Modules", () => {
    const section = extractSection(SAMPLE_REPORT, "Largest Modules by Output Contribution");
    expect(section).toContain("| Output Bytes |");
    expect(section).toContain("typescript/lib/typescript.js");
    expect(section).not.toContain("Quick Summary");
  });

  test("extractSection returns empty for missing heading", () => {
    expect(extractSection(SAMPLE_REPORT, "Nonexistent")).toBe("");
  });

  // ── parseQuickSummary ────────────────────────────────────────────

  test("parseQuickSummary parses all metrics", () => {
    const section = extractSection(SAMPLE_REPORT, "Quick Summary");
    const summary = parseQuickSummary(section);
    expect(summary).not.toBeNull();
    expect(summary!.totalBytes).toBeGreaterThan(10_000_000);
    expect(summary!.inputModules).toBe(351);
    expect(summary!.entryPoints).toBe(1);
    expect(summary!.nodeModulesFiles).toBe(192);
    expect(summary!.nodeModulesBytes).toBeGreaterThan(9_000_000);
    expect(summary!.esmModules).toBe(350);
    expect(summary!.cjsModules).toBe(1);
    expect(summary!.externalImports).toBe(275);
  });

  test("parseQuickSummary handles KB values", () => {
    const result = parseQuickSummary(`
| Metric | Value |
|--------|-------|
| Total output size | 500 KB |
`);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(500 * 1024);
  });

  test("parseQuickSummary handles B values", () => {
    const result = parseQuickSummary(`
| Metric | Value |
|--------|-------|
| Total output size | 1234 B |
`);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(1234);
  });

  test("parseQuickSummary handles GB values", () => {
    const result = parseQuickSummary(`
| Metric | Value |
|--------|-------|
| Total output size | 2.5 GB |
`);
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBeCloseTo(2.5 * 1024 * 1024 * 1024, -5);
  });

  test("parseQuickSummary returns zeroed summary for empty input", () => {
    const result = parseQuickSummary("");
    expect(result).not.toBeNull();
    expect(result!.totalBytes).toBe(0);
    expect(result!.inputModules).toBe(0);
  });

  // ── parseLargestModules ──────────────────────────────────────────

  test("parseLargestModules extracts top modules", () => {
    const section = extractSection(SAMPLE_REPORT, "Largest Modules by Output Contribution");
    const modules = parseLargestModules(section);
    expect(modules.length).toBe(5);
    expect(modules[0].module).toContain("typescript");
    expect(modules[0].pctOfTotal).toBe(84);
    expect(modules[0].format).toBe("cjs");
    expect(modules[0].outputBytes).toBeGreaterThan(8_000_000);
  });

  test("parseLargestModules skips header divider", () => {
    const section = extractSection(SAMPLE_REPORT, "Largest Modules by Output Contribution");
    const modules = parseLargestModules(section);
    // Should not include the divider row
    expect(modules.every((m) => !m.module.startsWith("-"))).toBe(true);
  });

  test("parseLargestModules stops at continuation note", () => {
    const section = extractSection(SAMPLE_REPORT, "Largest Modules by Output Contribution");
    const modules = parseLargestModules(section);
    // The "...and 346 more" line should not be parsed as a module
    expect(modules.length).toBeLessThan(10);
  });

  test("parseLargestModules handles KB entries", () => {
    const result = parseLargestModules(`
| Output Bytes | % of Total | Module | Format |
|--------------|------------|--------|--------|
| 161.43 KB | 1.5% | \`test.js\` | esm |
`);
    expect(result.length).toBe(1);
    expect(result[0].outputBytes).toBeCloseTo(161.43 * 1024, -1);
  });

  test("parseLargestModules returns empty for empty input", () => {
    expect(parseLargestModules("")).toEqual([]);
  });
});

// ── evaluate ────────────────────────────────────────────────────────

describe("bundle-gate evaluate", () => {
  function summary(overrides: Partial<BundleQuickSummary> = {}): BundleQuickSummary {
    return {
      totalBytes: 10 * 1024 * 1024,
      inputModules: 200,
      entryPoints: 1,
      nodeModulesBytes: 3 * 1024 * 1024,
      nodeModulesFiles: 50,
      esmModules: 199,
      cjsModules: 1,
      externalImports: 100,
      ...overrides,
    };
  }

  function topModule(overrides: Partial<BundleModuleRow> = {}): BundleModuleRow {
    return {
      outputBytes: 1024 * 1024,
      pctOfTotal: 10,
      module: "test.js",
      format: "esm",
      ...overrides,
    };
  }

  test("no findings when all thresholds are met", () => {
    const findings = evaluate(summary(), [topModule()], {
      projectRoot: ".",
      maxTotalBytes: 50 * 1024 * 1024,
      maxSingleModuleFraction: 0.5,
      maxNodeModulesFraction: 0.9,
      maxInputModules: 1000,
    });
    expect(findings).toEqual([]);
  });

  test("flags bundle-size when total exceeds threshold", () => {
    const findings = evaluate(summary({ totalBytes: 20 * 1024 * 1024 }), [topModule()], {
      projectRoot: ".",
      maxTotalBytes: 15 * 1024 * 1024,
    });
    const sizeFinding = findings.find((f) => f.rule === "bundle-size");
    expect(sizeFinding).toBeTruthy();
    expect(sizeFinding!.severity).toBe("error");
  });

  test("flags single-module-bloat when top module exceeds fraction", () => {
    const findings = evaluate(summary(), [topModule({ pctOfTotal: 50 })], {
      projectRoot: ".",
      maxSingleModuleFraction: 0.3,
    });
    const bloatFinding = findings.find((f) => f.rule === "single-module-bloat");
    expect(bloatFinding).toBeTruthy();
    expect(bloatFinding!.severity).toBe("warn");
  });

  test("flags node-modules-bloat when dependency share exceeds fraction", () => {
    const findings = evaluate(
      summary({ totalBytes: 10 * 1024 * 1024, nodeModulesBytes: 9 * 1024 * 1024 }),
      [topModule()],
      { projectRoot: ".", maxNodeModulesFraction: 0.6 }
    );
    const nmFinding = findings.find((f) => f.rule === "node-modules-bloat");
    expect(nmFinding).toBeTruthy();
    expect(nmFinding!.severity).toBe("warn");
  });

  test("flags module-count when input modules exceed threshold", () => {
    const findings = evaluate(summary({ inputModules: 600 }), [topModule()], {
      projectRoot: ".",
      maxInputModules: 500,
    });
    const countFinding = findings.find((f) => f.rule === "module-count");
    expect(countFinding).toBeTruthy();
    expect(countFinding!.severity).toBe("info");
  });

  test("multiple findings reported together", () => {
    const findings = evaluate(
      summary({ totalBytes: 50 * 1024 * 1024, inputModules: 1000 }),
      [topModule({ pctOfTotal: 80 })],
      { projectRoot: "." }
    );
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });
});

// ── runBundleGate integration ───────────────────────────────────────

describe("bundle-gate integration", () => {
  test("runBundleGate on default entry point succeeds", async () => {
    const report = await runBundleGate({ projectRoot: "." });
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("bundle-gate");
    expect(report.entryPoint).toBe("src/bin/kimi-doctor.ts");
    expect(report.summary).not.toBeNull();
    expect(report.summary!.totalBytes).toBeGreaterThan(0);
    expect(report.summary!.inputModules).toBeGreaterThan(0);
    expect(report.largestModules.length).toBeGreaterThan(0);
    expect(report.error).toBeNull();
  });

  test("runBundleGate on nonexistent entry point returns error", async () => {
    const report = await runBundleGate({
      projectRoot: ".",
      entryPoints: [{ path: "src/nonexistent.ts", target: "bun" }],
    });
    expect(report.ok).toBe(false);
    expect(report.summary).toBeNull();
    expect(report.findings.some((f) => f.rule === "no-entry-point")).toBe(true);
  });

  test("runBundleGate parses real typescript.js bloat", async () => {
    const report = await runBundleGate({ projectRoot: "." });
    const topModule = report.largestModules[0];
    // TypeScript itself is ~84% of the kimi-doctor bundle
    if (topModule) {
      expect(topModule.module).toContain("typescript");
      expect(topModule.pctOfTotal).toBeGreaterThan(50);
    }
    // Should flag both single-module-bloat and node-modules-bloat
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("single-module-bloat");
    expect(rules).toContain("node-modules-bloat");
  });
});
