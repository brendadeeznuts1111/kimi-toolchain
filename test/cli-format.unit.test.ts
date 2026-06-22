import { describe, expect, test } from "bun:test";
import {
  severityColor,
  severityLabel,
  severityIcon,
  statusColor,
  statusLabel,
  statusIcon,
  colorError,
  colorWarn,
  colorSuccess,
  colorInfo,
  colorDim,
  formatFinding,
  formatPatchResult,
  formatScannerSummary,
  findingsTable,
  withFindingInspect,
  withPatchInspect,
  withScannerResultInspect,
  visibleWidth,
  padVisible,
  formatTable,
} from "../src/lib/cli-format.ts";
import type {
  VulnerabilityFinding,
  PatchResult,
  ScannerPipelineResult,
  Severity,
} from "../src/lib/scanner-pipeline.ts";

// ── Severity Color Tests ─────────────────────────────────────────────

describe("cli-format > severity colors", () => {
  test("severityColor returns hex for each level", () => {
    expect(severityColor("critical")).toBe("#ff0000");
    expect(severityColor("high")).toBe("#ff6600");
    expect(severityColor("medium")).toBe("#ffcc00");
    expect(severityColor("low")).toBe("#0066ff");
    expect(severityColor("unknown")).toBe("#888888");
  });

  test("severityIcon returns emoji for each level", () => {
    expect(severityIcon("critical")).toBe("🔴");
    expect(severityIcon("high")).toBe("🟠");
    expect(severityIcon("medium")).toBe("🟡");
    expect(severityIcon("low")).toBe("🔵");
    expect(severityIcon("unknown")).toBe("⚪");
  });

  test("severityLabel returns uppercase text", () => {
    expect(severityLabel("critical")).toContain("CRITICAL");
    expect(severityLabel("high")).toContain("HIGH");
    expect(severityLabel("medium")).toContain("MEDIUM");
    expect(severityLabel("low")).toContain("LOW");
    expect(severityLabel("unknown")).toContain("UNKNOWN");
  });
});

// ── Status Color Tests ───────────────────────────────────────────────

describe("cli-format > status colors", () => {
  test("statusColor returns hex for known statuses", () => {
    expect(statusColor("ok")).toBe("#00ff00");
    expect(statusColor("present")).toBe("#00ff00");
    expect(statusColor("missing")).toBe("#ff0000");
    expect(statusColor("stale")).toBe("#ffcc00");
    expect(statusColor("unregistered")).toBe("#ff6600");
  });

  test("statusLabel returns text", () => {
    expect(statusLabel("ok")).toContain("ok");
    expect(statusLabel("missing")).toContain("missing");
  });

  test("statusIcon returns icon for known statuses", () => {
    expect(statusIcon("ok")).toContain("✓");
    expect(statusIcon("missing")).toContain("✗");
    expect(statusIcon("stale")).toContain("⚠");
  });
});

// ── Color Helper Tests ───────────────────────────────────────────────

describe("cli-format > color helpers", () => {
  test("colorError returns text containing input", () => {
    expect(colorError("test")).toContain("test");
  });

  test("colorWarn returns text containing input", () => {
    expect(colorWarn("test")).toContain("test");
  });

  test("colorSuccess returns text containing input", () => {
    expect(colorSuccess("test")).toContain("test");
  });

  test("colorInfo returns text containing input", () => {
    expect(colorInfo("test")).toContain("test");
  });

  test("colorDim returns text containing input", () => {
    expect(colorDim("test")).toContain("test");
  });
});

// ── Finding Formatter Tests ──────────────────────────────────────────

describe("cli-format > formatFinding", () => {
  const finding: VulnerabilityFinding = {
    name: "lodash",
    cveId: "CVE-2021-1234",
    severity: "high",
    cvssScore: 7.5,
    currentVersion: "4.17.20",
    fixedVersion: "4.17.21",
    range: "^4.17.0",
    strategy: "upgrade",
  };

  test("includes package name", () => {
    expect(formatFinding(finding)).toContain("lodash");
  });

  test("includes CVE ID", () => {
    expect(formatFinding(finding)).toContain("CVE-2021-1234");
  });

  test("includes severity label", () => {
    expect(formatFinding(finding)).toContain("HIGH");
  });

  test("includes strategy", () => {
    expect(formatFinding(finding)).toContain("upgrade");
  });

  test("includes version info", () => {
    expect(formatFinding(finding)).toContain("4.17.20");
    expect(formatFinding(finding)).toContain("4.17.21");
  });
});

// ── Patch Result Formatter Tests ─────────────────────────────────────

describe("cli-format > formatPatchResult", () => {
  test("success case", () => {
    const patch: PatchResult = {
      name: "lodash",
      strategy: "upgrade",
      success: true,
      message: "Upgraded to 4.17.21",
      patchedVersion: "4.17.21",
    };
    const result = formatPatchResult(patch);
    expect(result).toContain("lodash");
    expect(result).toContain("upgrade");
    expect(result).toContain("Upgraded to 4.17.21");
  });

  test("failure case", () => {
    const patch: PatchResult = {
      name: "lodash",
      strategy: "patch",
      success: false,
      message: "bun patch failed: error",
    };
    const result = formatPatchResult(patch);
    expect(result).toContain("lodash");
    expect(result).toContain("bun patch failed");
  });
});

// ── Scanner Summary Formatter Tests ──────────────────────────────────

describe("cli-format > formatScannerSummary", () => {
  test("no vulnerabilities", () => {
    const result: ScannerPipelineResult = {
      exitCode: 0,
      findings: [],
      patches: [],
      scanned: 5,
      vulnerabilities: 0,
      patched: 0,
      failed: 0,
      manual: 0,
    };
    const summary = formatScannerSummary(result);
    expect(summary).toContain("Scanned 5 deps");
    expect(summary).toContain("no vulnerabilities");
  });

  test("with vulnerabilities and patches", () => {
    const result: ScannerPipelineResult = {
      exitCode: 0,
      findings: [],
      patches: [],
      scanned: 10,
      vulnerabilities: 3,
      patched: 2,
      failed: 1,
      manual: 1,
    };
    const summary = formatScannerSummary(result);
    expect(summary).toContain("Scanned 10 deps");
    expect(summary).toContain("3 vulnerabilities");
    expect(summary).toContain("2 patched");
    expect(summary).toContain("1 failed");
    expect(summary).toContain("1 manual");
  });
});

// ── Findings Table Tests ─────────────────────────────────────────────

describe("cli-format > findingsTable", () => {
  test("empty findings returns success message", () => {
    const result = findingsTable([]);
    expect(result).toContain("No vulnerabilities found");
  });

  test("with findings returns formatted output", () => {
    const findings: VulnerabilityFinding[] = [
      {
        name: "lodash",
        cveId: "CVE-2021-1234",
        severity: "high",
        currentVersion: "4.17.20",
        fixedVersion: "4.17.21",
        range: "^4.17.0",
        strategy: "upgrade",
      },
    ];
    const result = findingsTable(findings);
    expect(result).toContain("lodash");
    expect(result).toContain("CVE-2021-1234");
  });
});

// ── Bun.inspect.custom Tests ─────────────────────────────────────────

describe("cli-format > Bun.inspect.custom attachers", () => {
  const INSPECT_SYMBOL = Symbol.for("nodejs.util.inspect.custom");

  test("withFindingInspect attaches custom inspect", () => {
    const finding: VulnerabilityFinding = {
      name: "lodash",
      cveId: "CVE-2021-1234",
      severity: "critical",
      currentVersion: "4.17.20",
      fixedVersion: "4.17.21",
      range: "^4.17.0",
      strategy: "upgrade",
    };
    const wrapped = withFindingInspect(finding);
    expect(typeof (wrapped as any)[INSPECT_SYMBOL]).toBe("function");
    const output = Bun.inspect(wrapped);
    expect(output).toContain("lodash");
    expect(output).toContain("CVE-2021-1234");
    expect(output).toContain("CRITICAL");
  });

  test("withPatchInspect attaches custom inspect", () => {
    const patch: PatchResult = {
      name: "lodash",
      strategy: "upgrade",
      success: true,
      message: "Upgraded to 4.17.21",
    };
    const wrapped = withPatchInspect(patch);
    expect(typeof (wrapped as any)[INSPECT_SYMBOL]).toBe("function");
    const output = Bun.inspect(wrapped);
    expect(output).toContain("lodash");
    expect(output).toContain("Upgraded to 4.17.21");
  });

  test("withScannerResultInspect attaches custom inspect", () => {
    const result: ScannerPipelineResult = {
      exitCode: 0,
      findings: [
        {
          name: "lodash",
          cveId: "CVE-2021-1234",
          severity: "high",
          currentVersion: "4.17.20",
          fixedVersion: "4.17.21",
          range: "^4.17.0",
          strategy: "upgrade",
        },
      ],
      patches: [],
      scanned: 5,
      vulnerabilities: 1,
      patched: 0,
      failed: 0,
      manual: 0,
    };
    const wrapped = withScannerResultInspect(result);
    expect(typeof (wrapped as any)[INSPECT_SYMBOL]).toBe("function");
    const output = Bun.inspect(wrapped);
    expect(output).toContain("Scanned 5 deps");
    expect(output).toContain("1 vulnerabilities");
    expect(output).toContain("lodash");
  });

  test("withFindingInspect preserves data access", () => {
    const finding: VulnerabilityFinding = {
      name: "lodash",
      cveId: "CVE-2021-1234",
      severity: "high",
      currentVersion: "4.17.20",
      fixedVersion: "4.17.21",
      range: "^4.17.0",
      strategy: "upgrade",
    };
    const wrapped = withFindingInspect(finding);
    expect(wrapped.name).toBe("lodash");
    expect(wrapped.cveId).toBe("CVE-2021-1234");
    expect(wrapped.severity).toBe("high");
    expect(wrapped.strategy).toBe("upgrade");
  });
});

// ── ANSI Width Helper Tests ──────────────────────────────────────────

describe("cli-format > visibleWidth", () => {
  test("plain string width", () => {
    expect(visibleWidth("hello")).toBe(5);
    expect(visibleWidth("")).toBe(0);
  });

  test("ignores ANSI escape codes", () => {
    const colored = `${Bun.color("#ff0000", "ansi")}red\x1b[0m`;
    expect(visibleWidth(colored)).toBe(3);
  });

  test("handles emoji correctly", () => {
    expect(visibleWidth("🔴")).toBe(2);
  });
});

describe("cli-format > padVisible", () => {
  test("pads plain string to width", () => {
    expect(padVisible("hi", 5)).toBe("hi   ");
  });

  test("does not pad when already at width", () => {
    expect(padVisible("hello", 5)).toBe("hello");
  });

  test("right-aligns when specified", () => {
    expect(padVisible("hi", 5, "right")).toBe("   hi");
  });

  test("pads correctly with ANSI codes", () => {
    const colored = `${Bun.color("#ff0000", "ansi")}red\x1b[0m`;
    const padded = padVisible(colored, 6);
    expect(Bun.stripANSI(padded)).toBe("red   ");
  });
});

describe("cli-format > formatTable", () => {
  test("formats rows with aligned columns", () => {
    const rows = [
      { Name: "lodash", Severity: "HIGH" },
      { Name: "express", Severity: "CRITICAL" },
    ];
    const table = formatTable(rows);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Severity");
    expect(lines[1]).toMatch(/─+/);
    expect(lines[2]).toContain("lodash");
  });

  test("empty rows returns empty string", () => {
    expect(formatTable([])).toBe("");
  });

  test("columns align with colored content", () => {
    const rows = [
      { Status: colorSuccess("ok"), Name: "short" },
      { Status: colorError("missing"), Name: "longername" },
    ];
    const table = formatTable(rows);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    const headerLine = lines[0];
    const firstRow = lines[2];
    const headerWidth = visibleWidth(headerLine);
    const rowWidth = visibleWidth(firstRow);
    expect(headerWidth).toBe(rowWidth);
  });
});
