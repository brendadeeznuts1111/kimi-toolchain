// test/heal/audit-effects.test.ts
// Snapshot tests for the kimi-heal effect audit rules.

import { describe, expect, test } from "bun:test";
import { relative } from "path";
import { auditEffects, type AuditIssue } from "../src/bin/kimi-heal.ts";

function normalizeIssues(issues: AuditIssue[]): AuditIssue[] {
  return issues
    .map((issue) => ({
      ...issue,
      file: issue.file === "globalThis" ? issue.file : relative(process.cwd(), issue.file),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
}

describe("audit-effects", () => {
  test("detects bare promises and direct effect imports", () => {
    const issues = auditEffects(undefined, {
      checkPipeline: false,
      checkBarePromises: true,
      checkDomainPurity: true,
      scanDir: "test/fixtures",
    });
    expect(normalizeIssues(issues)).toMatchSnapshot();
  });

  test("clean domain produces no errors", () => {
    const issues = auditEffects(undefined, {
      checkPipeline: false,
      checkBarePromises: true,
      checkDomainPurity: true,
      scanDir: "test/fixtures/clean",
    });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
