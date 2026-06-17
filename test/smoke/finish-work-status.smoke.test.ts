import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "../helpers.ts";
import { makeDir, removePath, writeText } from "../../src/lib/bun-io.ts";
import { invokeTool } from "../../src/lib/tool-runner.ts";
import { FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION } from "../../src/lib/finish-work-report-schema.ts";

const FINISH_WORK_STATUS = join(REPO_ROOT, "scripts/finish-work-status.ts");

function writeFixtureReport(root: string): void {
  makeDir(join(root, ".kimi"), { recursive: true });
  writeText(
    join(root, ".kimi", "finish-work-report.json"),
    JSON.stringify(
      {
        schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
        timestamp: "2026-06-17T08:00:00.000Z",
        agent: "kimi",
        paneId: "wB:p6F",
        durationMs: 900,
        git: { committed: true, pushed: true, hash: "bef2203", branch: "main" },
        tree: { clean: true, dirtyFiles: [], untracked: 0 },
        gates: {
          "check:fast": { status: "pass", durationMs: 8000 },
          "effect-gates": { status: "pass", durationMs: 1200 },
        },
        outcome: "clean",
        outcomeReason: "smoke fixture",
        review: {
          escalated: false,
          reviewerPane: null,
          reportPath: ".kimi/finish-work-report.json",
        },
        handoffCandidate: {
          shouldHandoff: true,
          targetAgent: "codex-primary",
          targetPane: "wB:p6G",
          reason: "clean close",
        },
        summary: "feat: smoke fixture — gates passed.",
      },
      null,
      2
    )
  );
}

describe("finish-work-status smoke", () => {
  test("reads and validates v1.1 fixture report --json", async () => {
    const root = testTempDir("fw-status-smoke-");
    try {
      writeFixtureReport(root);
      const result = await invokeTool(FINISH_WORK_STATUS, ["--json", "--project", root], {
        cwd: REPO_ROOT,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(0);

      const parsed = JSON.parse(result.stdout.trim()) as {
        ok: boolean;
        schemaVersion: string;
        report: { outcome: string; handoffCandidate?: { shouldHandoff: boolean } };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.schemaVersion).toBe(FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION);
      expect(parsed.report.outcome).toBe("clean");
      expect(parsed.report.handoffCandidate?.shouldHandoff).toBe(true);
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("exits non-zero when report missing", async () => {
    const root = testTempDir("fw-status-missing-");
    try {
      makeDir(join(root, ".kimi"), { recursive: true });
      const result = await invokeTool(FINISH_WORK_STATUS, ["--json", "--project", root], {
        cwd: REPO_ROOT,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stdout.trim()) as { ok: boolean; error?: string };
      expect(parsed.ok).toBe(false);
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  }, 15_000);
});
