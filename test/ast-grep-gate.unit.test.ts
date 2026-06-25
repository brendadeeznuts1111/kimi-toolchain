import { describe, expect, test } from "bun:test";
import {
  buildReport,
  evaluateHits,
  EXEMPT_FILES,
  renderHtmlReport,
  type AstGrepHit,
} from "../src/lib/ast-grep-gate.ts";

const PROJECT_ROOT = "/fake/repo";

function makeHit(
  ruleId: string,
  file: string,
  line: number,
  severity: "error" | "warning" = "warning",
  message = "test message"
): AstGrepHit {
  return {
    text: "snippet",
    file,
    lines: "  import { X } from './foo.ts'",
    range: {
      start: { line: line - 1, column: 2 },
      end: { line: line - 1, column: 30 },
    },
    language: "TypeScript",
    ruleId,
    message,
    severity,
  };
}

describe("ast-grep-gate", () => {
  test("evaluateHits applies per-rule file exemptions", () => {
    const hits = [
      makeHit("no-direct-registry-import", `${PROJECT_ROOT}/src/lib/bun-utils.ts`, 10),
      makeHit("no-direct-registry-import", `${PROJECT_ROOT}/src/lib/safe-parse.ts`, 11),
      makeHit("no-manual-feature-url", `${PROJECT_ROOT}/src/lib/bun-release-registry.ts`, 211),
      makeHit("no-manual-feature-url", `${PROJECT_ROOT}/scripts/head-table-typed.ts`, 417),
    ];

    const { violations, exempted } = evaluateHits(hits, PROJECT_ROOT);

    expect(violations).toHaveLength(2);
    expect(exempted).toHaveLength(2);
    expect(exempted.map((v) => v.ruleId).sort()).toEqual([
      "no-direct-registry-import",
      "no-manual-feature-url",
    ]);
    expect(violations.map((v) => v.file).sort()).toEqual([
      "scripts/head-table-typed.ts",
      "src/lib/safe-parse.ts",
    ]);
  });

  test("buildReport marks fail=true only on error severity", () => {
    const violations = [
      {
        ruleId: "r1",
        file: "a.ts",
        line: 1,
        column: 1,
        message: "m",
        severity: "warning" as const,
        snippet: "x",
      },
      {
        ruleId: "r2",
        file: "b.ts",
        line: 2,
        column: 1,
        message: "m",
        severity: "warning" as const,
        snippet: "y",
      },
    ];
    const report = buildReport(violations, [], "sgconfig.yml", 100);
    expect(report.summary.fail).toBe(false);
    expect(report.summary.warnings).toBe(2);
    expect(report.summary.errors).toBe(0);
  });

  test("buildReport marks fail=true when errors present", () => {
    const violations = [
      {
        ruleId: "r1",
        file: "a.ts",
        line: 1,
        column: 1,
        message: "m",
        severity: "error" as const,
        snippet: "x",
      },
    ];
    const report = buildReport(violations, [], "sgconfig.yml", 50);
    expect(report.summary.fail).toBe(true);
    expect(report.summary.errors).toBe(1);
  });

  test("renderHtmlReport produces valid HTML with PASS status", () => {
    const report = buildReport([], [], "sgconfig.yml", 42);
    const html = renderHtmlReport(report);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("PASS");
    expect(html).toContain("0</strong>violations");
  });

  test("renderHtmlReport produces FAIL status with error violations", () => {
    const report = buildReport(
      [
        {
          ruleId: "r1",
          file: "a.ts",
          line: 1,
          column: 1,
          message: "bad",
          severity: "error",
          snippet: "x",
        },
      ],
      [],
      "sgconfig.yml",
      50
    );
    const html = renderHtmlReport(report);
    expect(html).toContain("FAIL");
    expect(html).toContain("bad");
  });

  test("EXEMPT_FILES covers the legitimate source files", () => {
    expect(EXEMPT_FILES["no-direct-registry-import"]).toContain("src/lib/bun-utils.ts");
    expect(EXEMPT_FILES["no-manual-feature-url"]).toContain("src/lib/bun-release-registry.ts");
    expect(EXEMPT_FILES["prefer-bun-serve-routes"]).toContain(
      "src/lib/herdr-dashboard/server/router.ts",
    );
  });

  test("evaluateHits exempts prefer-bun-serve-routes in legacy router.ts", () => {
    const hits = [
      makeHit(
        "prefer-bun-serve-routes",
        `${PROJECT_ROOT}/src/lib/herdr-dashboard/server/router.ts`,
        196,
      ),
      makeHit("prefer-bun-serve-routes", `${PROJECT_ROOT}/src/lib/card-probe-server.ts`, 12),
    ];
    const { violations, exempted } = evaluateHits(hits, PROJECT_ROOT);
    expect(exempted).toHaveLength(1);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("src/lib/card-probe-server.ts");
  });
});
