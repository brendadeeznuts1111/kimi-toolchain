import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import { testTempDir } from "./helpers.ts";
import {
  logDecision,
  readDecisions,
  updateDecisionOutcome,
  type Decision,
} from "../src/lib/decision-ledger.ts";
import {
  scoreDecision,
  scoreAllDecisionsEffect,
  filterLowQualityDecisions,
} from "../src/lib/decision-scoring.ts";
import { suggestDecisions } from "../src/lib/decision-ledger.ts";
import { rewriteFailureLedger } from "../src/lib/failure-ledger.ts";
import { rewriteNdjsonFile } from "../src/lib/ndjson.ts";
import { decisionsNdjsonPath, failureLedgerPath } from "../src/lib/paths.ts";
import { readFailureTraceRecords } from "../src/lib/trace-ledger.ts";

describe("decision-scoring integration", () => {
  let tmpRoot: string;
  let tmpHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = Bun.env.HOME;
    tmpRoot = testTempDir("kimi-score-");
    tmpHome = testTempDir("kimi-score-home-");
    makeDir(join(tmpRoot, ".kimi"), { recursive: true });
    makeDir(join(tmpHome, ".kimi-code", "var"), { recursive: true });
    Bun.env.HOME = tmpHome;
    Bun.env.KIMI_TRACE_ID = "trace-score-test";
  });

  afterEach(() => {
    if (previousHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previousHome;
    delete Bun.env.KIMI_TRACE_ID;
    if (tmpRoot) removePath(tmpRoot, { recursive: true, force: true });
    if (tmpHome) removePath(tmpHome, { recursive: true, force: true });
  });

  test("cluster recurrence within 24h yields low quality score", async () => {
    const healTime = new Date("2026-06-01T12:00:00.000Z");
    const decision = await logDecision(
      {
        action: "heal",
        trigger: { traceId: "trace-heal-1", clusterId: "cluster-lock" },
        outcome: { result: "success", verifiedAt: healTime.toISOString() },
        metadata: { playbookId: "regenerate-bun-lockfile" },
      },
      { projectRoot: tmpRoot }
    );

    await rewriteFailureLedger(
      [
        {
          errorId: "err-recur",
          clusterId: "cluster-lock",
          timestamp: "2026-06-01T18:00:00.000Z",
          output: "lockfile hash mismatch again",
          toolName: "kimi-guardian",
        },
      ],
      failureLedgerPath()
    );

    const all = await readDecisions(tmpRoot);
    const failures = await readFailureTraceRecords();
    const scored = scoreDecision(decision, all, failures, new Date("2026-06-02T00:00:00.000Z"));

    expect(scored.qualityScore).toBeLessThanOrEqual(0.25);
    expect(scored.factors.some((f) => f.includes("cluster-recurred-24h"))).toBe(true);
  });

  test("scoreAllDecisions finishes 1000 decisions under 1s", async () => {
    const bulk: Decision[] = Array.from({ length: 1000 }, (_, i) => ({
      schemaVersion: 2 as const,
      decisionId: `dec-bulk-${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      actor: "kimi" as const,
      action: "heal" as const,
      trigger: { traceId: `trace-bulk-${i}`, clusterId: `cluster-${i % 20}` },
      rationale: {
        summary: `bulk ${i}`,
        fullReasoning: `bulk decision ${i}`,
        evidence: [],
      },
      alternatives: [],
      outcome: { result: i % 5 === 0 ? ("failure" as const) : ("success" as const) },
      qualityScore: 0.5,
    }));
    await rewriteNdjsonFile(decisionsNdjsonPath(tmpRoot), bulk);

    const report = await Effect.runPromise(scoreAllDecisionsEffect({ projectRoot: tmpRoot }));
    expect(report.total).toBe(1000);
    expect(report.durationMs).toBeLessThan(1000);
  });

  test("suggest returns playbook for known cluster after successful heal", async () => {
    const decision = await logDecision(
      {
        action: "heal",
        trigger: { traceId: "trace-suggest", clusterId: "cluster-format" },
        outcome: { result: "success" },
        metadata: { playbookId: "run-format-fix" },
      },
      { projectRoot: tmpRoot }
    );
    await updateDecisionOutcome(
      decision.decisionId,
      { result: "success", verifiedAt: new Date().toISOString() },
      { projectRoot: tmpRoot, qualityScore: 0.92 }
    );

    const suggestions = await suggestDecisions({
      clusterId: "cluster-format",
      projectRoot: tmpRoot,
    });

    expect(suggestions[0]?.playbookId).toBe("run-format-fix");
    expect(suggestions[0]?.qualityScore).toBeGreaterThanOrEqual(0.9);
  });

  test("filterLowQualityDecisions surfaces failed heals", async () => {
    await logDecision(
      {
        action: "heal",
        trigger: { traceId: "trace-bad", clusterId: "cluster-bad" },
        outcome: { result: "failure" },
      },
      { projectRoot: tmpRoot }
    );
    await updateDecisionOutcome(
      (await readDecisions(tmpRoot))[0]!.decisionId,
      { result: "failure" },
      { projectRoot: tmpRoot, qualityScore: 0.15 }
    );

    const low = filterLowQualityDecisions(await readDecisions(tmpRoot));
    expect(low.length).toBe(1);
    expect(low[0]?.outcome.result).toBe("failure");
  });
});
