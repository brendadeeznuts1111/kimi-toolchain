import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  evaluateFinishWorkReportConditions,
  evaluatePaneConditions,
  evaluateWhenConditions,
  getValueAtPath,
  parseWhenTable,
  whenIncludesPaneStatus,
} from "../src/lib/condition-evaluator.ts";
import { FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION } from "../src/lib/finish-work-report-schema.ts";
import { parseHandoffRuleEntry } from "../src/lib/herdr-orchestrator-config.ts";
import { $ } from "bun";

function writeV11Report(root: string, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(root, ".kimi"), { recursive: true });
  const head = (overrides.git as { head?: string } | undefined)?.head ?? "abc123def4567890abcd";
  const body = {
    schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
    timestamp: "2026-06-17T02:37:00.000Z",
    git: { committed: true, pushed: true, hash: "d6bc96d", head },
    tree: { clean: true, dirtyFiles: [], untracked: 0 },
    gates: { "check:fast": { status: "pass", durationMs: 1 } },
    outcome: "clean",
    outcomeReason: "All gates passed + clean tree after push",
    summary: "feat: test — gates passed, pushed d6bc96d, tree clean.",
    handoffCandidate: {
      targetPane: "wB:p6G",
      targetAgent: "codex-primary",
      reason: "clean finish-work close",
      shouldHandoff: true,
    },
    review: { escalated: false, reviewerPane: null, reportPath: ".kimi/finish-work-report.json" },
    latm: { markerSeen: true, completionSignal: "__LATM_DONE__", invokedVia: "finish-work --push" },
    ...overrides,
  };
  writeFileSync(join(root, ".kimi", "finish-work-report.json"), JSON.stringify(body, null, 2));
}

describe("condition-evaluator", () => {
  test("parseWhenTable reads inline TOML when shape", () => {
    const clauses = parseWhenTable({
      "finishWorkReport.outcome": "clean",
      "finishWorkReport.handoffCandidate.shouldHandoff": true,
    });
    expect(clauses).toEqual([
      { path: "finishWorkReport.outcome", expected: "clean" },
      { path: "finishWorkReport.handoffCandidate.shouldHandoff", expected: true },
    ]);
  });

  test("parseHandoffRuleEntry accepts when without legacy condition", () => {
    const rule = parseHandoffRuleEntry({
      from_workspace: "wB",
      from_agent: "kimi",
      to_workspace: "wB",
      to_agent: "codex-primary",
      when: { "finishWorkReport.outcome": "clean" },
    });
    expect(rule?.condition).toBe("report:when");
    expect(rule?.when?.[0]?.path).toBe("finishWorkReport.outcome");
  });

  test("getValueAtPath resolves nested report fields", () => {
    const report = {
      outcome: "clean",
      handoffCandidate: { shouldHandoff: true, targetAgent: "codex-primary" },
    };
    expect(getValueAtPath(report, "outcome")).toBe("clean");
    expect(getValueAtPath(report, "handoffCandidate.shouldHandoff")).toBe(true);
  });

  test("evaluateFinishWorkReportConditions passes matching clauses", async () => {
    const root = join(tmpdir(), `cond-eval-${Bun.randomUUIDv7()}`);
    writeV11Report(root);

    const result = await evaluateFinishWorkReportConditions(root, [
      { path: "finishWorkReport.outcome", expected: "clean" },
      { path: "finishWorkReport.handoffCandidate.shouldHandoff", expected: true },
    ]);
    expect(result.ok).toBe(true);
  });

  test("evaluateFinishWorkReportConditions rejects stale report", async () => {
    const root = join(tmpdir(), `cond-stale-${Bun.randomUUIDv7()}`);
    mkdirSync(root, { recursive: true });
    await $`git init`.cwd(root).nothrow().quiet();
    await $`git commit --allow-empty -m init`.cwd(root).nothrow().quiet();
    writeV11Report(root, {
      git: {
        committed: true,
        pushed: true,
        hash: "d6bc96d",
        head: "0000000000000000000000000000000000000000",
      },
    });

    const result = await evaluateFinishWorkReportConditions(root, [
      { path: "finishWorkReport.outcome", expected: "clean" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("stale");
  });

  test("evaluateFinishWorkReportConditions reports field mismatch", async () => {
    const root = join(tmpdir(), `cond-mismatch-${Bun.randomUUIDv7()}`);
    writeV11Report(root, { outcome: "dirty" });

    const result = await evaluateFinishWorkReportConditions(root, [
      { path: "finishWorkReport.outcome", expected: "clean" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("finishWorkReport.outcome");
  });

  test("evaluatePaneConditions matches source agent status", () => {
    const agent = {
      paneId: "wB:p6F",
      agent: "kimi",
      status: "idle",
      workspaceId: "wB",
    };
    const ok = evaluatePaneConditions(agent, [{ path: "pane.status", expected: "idle" }]);
    expect(ok.ok).toBe(true);

    const bad = evaluatePaneConditions(agent, [{ path: "pane.status", expected: "working" }]);
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("pane.status");
  });

  test("evaluateWhenConditions combines report and pane clauses", async () => {
    const root = join(tmpdir(), `cond-combined-${Bun.randomUUIDv7()}`);
    writeV11Report(root, {
      review: {
        escalated: false,
        reviewerPane: "wB:p6E",
        reportPath: ".kimi/finish-work-report.json",
        resolved: true,
      },
    });

    const agent = {
      paneId: "wB:p6F",
      agent: "kimi",
      status: "idle",
      workspaceId: "wB",
    };

    const result = await evaluateWhenConditions(
      root,
      [
        { path: "finishWorkReport.handoffCandidate.shouldHandoff", expected: true },
        { path: "finishWorkReport.review.resolved", expected: true },
        { path: "pane.status", expected: "idle" },
      ],
      agent
    );
    expect(result.ok).toBe(true);
  });

  test("whenIncludesPaneStatus detects pane.status clause", () => {
    expect(
      whenIncludesPaneStatus([
        { path: "finishWorkReport.review.resolved", expected: true },
        { path: "pane.status", expected: "idle" },
      ])
    ).toBe(true);
    expect(whenIncludesPaneStatus([{ path: "finishWorkReport.outcome", expected: "clean" }])).toBe(
      false
    );
  });
});
