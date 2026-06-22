import { describe, test, expect } from "bun:test";
import {
  findingsToSarif,
  scannerResultToSarif,
  summarizeScanResult,
  type VulnerabilityFinding,
  type ScannerPipelineResult,
  type PatchResult,
} from "../src/lib/scanner-pipeline.ts";

function makeFinding(overrides: Partial<VulnerabilityFinding> = {}): VulnerabilityFinding {
  return {
    name: "lodash",
    cveId: "CVE-2021-23337",
    severity: "high",
    cvssScore: 7.4,
    currentVersion: "4.17.20",
    fixedVersion: "4.17.21",
    range: "^4.17.0",
    strategy: "upgrade",
    ...overrides,
  };
}

function makePatchResult(overrides: Partial<PatchResult> = {}): PatchResult {
  return {
    name: "lodash",
    strategy: "upgrade",
    success: true,
    message: "Upgraded to 4.17.21",
    patchedVersion: "4.17.21",
    ...overrides,
  };
}

function makeScanResult(overrides: Partial<ScannerPipelineResult> = {}): ScannerPipelineResult {
  return {
    exitCode: 0,
    findings: [],
    patches: [],
    scanned: 10,
    vulnerabilities: 0,
    patched: 0,
    failed: 0,
    manual: 0,
    ...overrides,
  };
}

describe("scanner-pipeline > SARIF output", () => {
  test("findingsToSarif produces valid SARIF v2.1.0 structure", () => {
    const findings = [makeFinding()];
    const sarif = findingsToSarif(findings);

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("kimi-toolchain-scanner");
    expect(sarif.runs[0].results).toHaveLength(1);
  });

  test("findingsToSarif maps severity to SARIF levels correctly", () => {
    const findings: VulnerabilityFinding[] = [
      makeFinding({ severity: "critical", cveId: "CVE-CRIT" }),
      makeFinding({ severity: "high", cveId: "CVE-HIGH" }),
      makeFinding({ severity: "medium", cveId: "CVE-MED" }),
      makeFinding({ severity: "low", cveId: "CVE-LOW" }),
      makeFinding({ severity: "unknown", cveId: "CVE-UNK" }),
    ];

    const sarif = findingsToSarif(findings);
    const levels = sarif.runs[0].results.map((r) => r.level);

    expect(levels).toEqual(["error", "error", "warning", "note", "none"]);
  });

  test("findingsToSarif includes package metadata in properties", () => {
    const findings = [makeFinding({ cvssScore: 9.8 })];
    const sarif = findingsToSarif(findings);
    const props = sarif.runs[0].results[0].properties!;

    expect(props.package).toBe("lodash");
    expect(props.currentVersion).toBe("4.17.20");
    expect(props.fixedVersion).toBe("4.17.21");
    expect(props.severity).toBe("high");
    expect(props.cvssScore).toBe(9.8);
    expect(props.strategy).toBe("upgrade");
  });

  test("findingsToSarif sets ruleId to CVE ID", () => {
    const findings = [makeFinding({ cveId: "CVE-2024-12345" })];
    const sarif = findingsToSarif(findings);

    expect(sarif.runs[0].results[0].ruleId).toBe("CVE-2024-12345");
  });

  test("findingsToSarif includes partial fingerprints for dedup", () => {
    const findings = [makeFinding()];
    const sarif = findingsToSarif(findings);
    const fp = sarif.runs[0].results[0].partialFingerprints!;

    expect(fp["package:vulnerability"]).toBe("lodash@4.17.20:CVE-2021-23337");
  });

  test("findingsToSarif handles empty findings", () => {
    const sarif = findingsToSarif([]);

    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].results).toHaveLength(0);
  });

  test("findingsToSarif handles missing fixed version", () => {
    const findings = [makeFinding({ fixedVersion: undefined })];
    const sarif = findingsToSarif(findings);
    const msg = sarif.runs[0].results[0].message.text;

    expect(msg).toContain("fix: none");
  });
});

describe("scanner-pipeline > scannerResultToSarif", () => {
  test("includes patch outcomes in properties", () => {
    const result = makeScanResult({
      findings: [makeFinding()],
      patches: [makePatchResult({ success: true })],
      patched: 1,
    });

    const sarif = scannerResultToSarif(result);
    const props = sarif.runs[0].results[0].properties!;

    expect(props.patched).toBe(true);
    expect(props.patchMessage).toBe("Upgraded to 4.17.21");
  });

  test("marks failed patches correctly", () => {
    const result = makeScanResult({
      findings: [makeFinding()],
      patches: [makePatchResult({ success: false, message: "bun update failed" })],
      failed: 1,
    });

    const sarif = scannerResultToSarif(result);
    const props = sarif.runs[0].results[0].properties!;

    expect(props.patched).toBe(false);
    expect(props.patchMessage).toBe("bun update failed");
  });

  test("handles findings with no patches", () => {
    const result = makeScanResult({
      findings: [makeFinding()],
      patches: [],
    });

    const sarif = scannerResultToSarif(result);
    const props = sarif.runs[0].results[0].properties!;

    expect(props.patched).toBe(false);
    expect(props.patchMessage).toBeUndefined();
  });
});

describe("scanner-pipeline > summarizeScanResult", () => {
  test("summarizes clean scan (no findings)", () => {
    const result = makeScanResult({ scanned: 15 });
    const summary = summarizeScanResult(result);

    expect(summary).toContain("Scanned 15 dependencies");
    expect(summary).toContain("Vulnerabilities: 0");
    expect(summary).not.toContain("Findings:");
  });

  test("summarizes scan with findings", () => {
    const result = makeScanResult({
      scanned: 10,
      findings: [makeFinding()],
      vulnerabilities: 1,
    });
    const summary = summarizeScanResult(result);

    expect(summary).toContain("Vulnerabilities: 1");
    expect(summary).toContain("Findings:");
    expect(summary).toContain("lodash@4.17.20");
    expect(summary).toContain("CVE-2021-23337");
    expect(summary).toContain("→ 4.17.21");
  });

  test("summarizes scan with patches", () => {
    const result = makeScanResult({
      scanned: 10,
      findings: [makeFinding()],
      patches: [makePatchResult()],
      patched: 1,
    });
    const summary = summarizeScanResult(result);

    expect(summary).toContain("Patches:");
    expect(summary).toContain("✓ lodash");
    expect(summary).toContain("Upgraded to 4.17.21");
  });

  test("shows failed patches with ✗", () => {
    const result = makeScanResult({
      scanned: 10,
      findings: [makeFinding()],
      patches: [makePatchResult({ success: false, message: "Failed" })],
      failed: 1,
    });
    const summary = summarizeScanResult(result);

    expect(summary).toContain("✗ lodash");
    expect(summary).toContain("Failed");
  });

  test("shows no fix for findings without fixedVersion", () => {
    const result = makeScanResult({
      findings: [makeFinding({ fixedVersion: undefined })],
    });
    const summary = summarizeScanResult(result);

    expect(summary).toContain("(no fix)");
  });
});
