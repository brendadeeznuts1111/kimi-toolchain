import { describe, expect, test } from "bun:test";
import { semver } from "bun";
import {
  parseSeverity,
  severityMeetsThreshold,
  evaluateVulnerability,
  evaluateScanResults,
  runScannerPipeline,
  discoverTargets,
  type DependencyInfo,
  type OsvVulnerability,
  type Severity,
} from "../src/lib/scanner-pipeline.ts";

// ── Severity Tests ───────────────────────────────────────────────────

describe("scanner-pipeline > severity", () => {
  test("parseSeverity converts CVSS scores correctly", () => {
    expect(parseSeverity("9.5")).toBe("critical");
    expect(parseSeverity("9.0")).toBe("critical");
    expect(parseSeverity("8.9")).toBe("high");
    expect(parseSeverity("7.0")).toBe("high");
    expect(parseSeverity("6.5")).toBe("medium");
    expect(parseSeverity("4.0")).toBe("medium");
    expect(parseSeverity("3.5")).toBe("low");
    expect(parseSeverity("0.1")).toBe("low");
    expect(parseSeverity(undefined)).toBe("unknown");
    expect(parseSeverity("not-a-number")).toBe("unknown");
  });

  test("severityMeetsThreshold filters correctly", () => {
    expect(severityMeetsThreshold("critical", "low")).toBe(true);
    expect(severityMeetsThreshold("critical", "critical")).toBe(true);
    expect(severityMeetsThreshold("low", "critical")).toBe(false);
    expect(severityMeetsThreshold("medium", "high")).toBe(false);
    expect(severityMeetsThreshold("high", "high")).toBe(true);
    expect(severityMeetsThreshold("unknown", "low")).toBe(false);
  });
});

// ── Evaluate Tests ───────────────────────────────────────────────────

describe("scanner-pipeline > evaluateVulnerability", () => {
  const dep: DependencyInfo = {
    name: "lodash",
    current: "4.17.20",
    range: "^4.17.0",
  };

  test("returns upgrade strategy when fixed version is in range", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2021-1234",
      severity: [{ score: "7.5" }],
      fixed: "4.17.21",
    };
    const finding = evaluateVulnerability(dep, vuln);
    expect(finding.strategy).toBe("upgrade");
    expect(finding.severity).toBe("high");
    expect(finding.cveId).toBe("CVE-2021-1234");
    expect(finding.fixedVersion).toBe("4.17.21");
  });

  test("returns manual strategy when fixed version is outside range", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2021-5678",
      severity: [{ score: "9.8" }],
      fixed: "5.0.0",
    };
    const finding = evaluateVulnerability(dep, vuln);
    expect(finding.strategy).toBe("manual");
    expect(finding.severity).toBe("critical");
  });

  test("returns manual strategy when no fixed version available", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2021-9999",
      severity: [{ score: "5.0" }],
    };
    const finding = evaluateVulnerability(dep, vuln);
    expect(finding.strategy).toBe("manual");
    expect(finding.severity).toBe("medium");
    expect(finding.fixedVersion).toBeUndefined();
  });

  test("returns manual strategy when fixed version is not newer", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2021-0001",
      severity: [{ score: "3.0" }],
      fixed: "4.17.20",
    };
    const finding = evaluateVulnerability(dep, vuln);
    expect(finding.strategy).toBe("manual");
  });

  test("parses unknown severity when score missing", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2021-0002",
    };
    const finding = evaluateVulnerability(dep, vuln);
    expect(finding.severity).toBe("unknown");
    expect(finding.cvssScore).toBeUndefined();
  });
});

// ── Evaluate Scan Results Tests ──────────────────────────────────────

describe("scanner-pipeline > evaluateScanResults", () => {
  test("filters by severity threshold", () => {
    const scanResults = [
      {
        dep: { name: "pkg-a", current: "1.0.0", range: "^1.0.0" },
        vulns: [
          { id: "CVE-1", severity: [{ score: "9.5" }], fixed: "1.0.1" },
          { id: "CVE-2", severity: [{ score: "2.0" }] },
        ],
      },
      {
        dep: { name: "pkg-b", current: "2.0.0", range: "^2.0.0" },
        vulns: [{ id: "CVE-3", severity: [{ score: "7.0" }], fixed: "2.0.1" }],
      },
    ];

    const all = evaluateScanResults(scanResults, "low");
    expect(all).toHaveLength(3);

    const highOnly = evaluateScanResults(scanResults, "high");
    expect(highOnly).toHaveLength(2);
    expect(highOnly.every((f) => f.severity === "critical" || f.severity === "high")).toBe(true);

    const criticalOnly = evaluateScanResults(scanResults, "critical");
    expect(criticalOnly).toHaveLength(1);
    expect(criticalOnly[0].severity).toBe("critical");
  });

  test("returns empty array for no vulnerabilities", () => {
    const results = evaluateScanResults([], "low");
    expect(results).toHaveLength(0);
  });
});

// ── Full Pipeline Tests (dry-run) ────────────────────────────────────

describe("scanner-pipeline > runScannerPipeline", () => {
  test("returns exit code 0 when no vulnerabilities found", async () => {
    // Use a package that definitely has no vulnerabilities
    const result = await runScannerPipeline({
      dependencies: [{ name: "@types/node", current: "99.99.99", range: "^99.0.0" }],
      dryRun: true,
      maxScanDeps: 1,
    });
    expect(result.exitCode).toBe(0);
    expect(result.vulnerabilities).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  test("respects maxScanDeps limit", async () => {
    const deps = Array.from({ length: 5 }, (_, i) => ({
      name: `nonexistent-pkg-${i}`,
      current: "1.0.0",
      range: "^1.0.0",
    }));
    const result = await runScannerPipeline({
      dependencies: deps,
      dryRun: true,
      maxScanDeps: 2,
    });
    expect(result.scanned).toBe(2);
  });

  test("dry-run does not patch", async () => {
    const result = await runScannerPipeline({
      dependencies: [{ name: "@types/node", current: "99.99.99", range: "^99.0.0" }],
      dryRun: true,
      patch: true,
    });
    expect(result.patches).toHaveLength(0);
    expect(result.patched).toBe(0);
  });
});

// ── Bun.semver Integration Tests ─────────────────────────────────────

describe("scanner-pipeline > Bun.semver integration", () => {
  test("semver.satisfies works for range checking", () => {
    expect(semver.satisfies("1.2.1", "^1.2.0")).toBe(true);
    expect(semver.satisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(semver.satisfies("1.2.0", "~1.2.0")).toBe(true);
    expect(semver.satisfies("1.3.0", "~1.2.0")).toBe(false);
  });

  test("semver.order compares versions correctly", () => {
    expect(semver.order("1.2.1", "1.2.0")).toBe(1);
    expect(semver.order("1.2.0", "1.2.1")).toBe(-1);
    expect(semver.order("1.2.0", "1.2.0")).toBe(0);
  });
});

// ── discoverTargets Tests (Bun.Glob) ────────────────────────────────

describe("scanner-pipeline > discoverTargets", () => {
  test("discovers dependencies from root package.json", async () => {
    const deps = await discoverTargets(Bun.cwd);
    expect(deps.length).toBeGreaterThan(0);
    const names = deps.map((d) => d.name);
    expect(names).toContain("effect");
  });

  test("strips range prefixes from current version", async () => {
    const deps = await discoverTargets(Bun.cwd);
    for (const dep of deps) {
      expect(dep.current).not.toMatch(/^[\^~>=<]/);
    }
  });

  test("deduplicates dependencies", async () => {
    const deps = await discoverTargets(Bun.cwd);
    const names = deps.map((d) => d.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  test("includeDev=false excludes devDependencies", async () => {
    const withDev = await discoverTargets(Bun.cwd, { includeDev: true });
    const withoutDev = await discoverTargets(Bun.cwd, { includeDev: false });
    expect(withoutDev.length).toBeLessThanOrEqual(withDev.length);
  });
});
