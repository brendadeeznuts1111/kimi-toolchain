import { Effect } from "effect";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  previewDecisionId,
  readDecisionLedger,
  recordDecision,
} from "../src/lib/decision-ledger.ts";
import { applyHealPlanEffect, buildHealPlanEffect, type HealPlan } from "../src/lib/self-healing.ts";
import { clusterFailureLedgerEffect } from "../src/lib/error-clustering.ts";
import { writeFileSync } from "fs";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-heal-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("self-healing", () => {
  test("buildHealPlan surfaces cluster playbook actions", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        [
          JSON.stringify({
            errorId: "error-heal-1",
            traceId: "trace-lock",
            toolName: "kimi-guardian",
            output: "HASH MISMATCH for bun.lock",
            taxonomyId: "lockfile_issue",
          }),
        ].join("\n")
      );

      const clusters = await Effect.runPromise(
        clusterFailureLedgerEffect({
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
          clustersPath: join(dir, "error-clusters.json"),
          threshold: 0.35,
        })
      );

      const plan = await Effect.runPromise(buildHealPlanEffect(dir, {
        clusters,
        capabilities: {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          readiness: 100,
          readinessScore: 100,
          healthy: 0,
          degraded: 0,
          unavailable: 0,
          checks: [],
        },
      });
      const clusterAction = plan.actions.find((action) => action.source === "cluster");
      expect(clusterAction).toBeTruthy();
      expect(clusterAction?.metadata?.clusterId).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildHealPlan does not record capability decisions while planning", async () => {
    const dir = tempDir();
    const oldHome = Bun.env.HOME;
    mkdirSync(join(dir, ".kimi-code", "var"), { recursive: true });
    try {
      Bun.env.HOME = dir;
      await Effect.runPromise(buildHealPlanEffect(dir));

      const ledger = await readDecisionLedger();
      expect(ledger).toHaveLength(0);
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("format playbook remains manual because it edits source", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        [
          JSON.stringify({
            errorId: "error-format-1",
            traceId: "trace-format",
            toolName: "format:check",
            output: "format check failed",
            taxonomyId: "format_check_failure",
          }),
        ].join("\n")
      );

      const clusters = await Effect.runPromise(
        clusterFailureLedgerEffect({
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
          clustersPath: join(dir, "error-clusters.json"),
          threshold: 0.35,
        })
      );
      const plan = await Effect.runPromise(buildHealPlanEffect(dir, {
        clusters,
        capabilities: {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          readiness: 100,
          readinessScore: 100,
          healthy: 0,
          degraded: 0,
          unavailable: 0,
          checks: [],
        },
      });
      const formatAction = plan.actions.find(
        (action) => action.metadata?.taxonomyId === "format_check_failure"
      );

      expect(formatAction?.safeToAutoApply).toBe(false);
      expect(formatAction?.status).toBe("manual");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyHealPlan records preview decision before execute and appends outcome follow-up", async () => {
    const dir = tempDir();
    const oldHome = Bun.env.HOME;
    mkdirSync(join(dir, ".kimi-code", "var"), { recursive: true });
    try {
      Bun.env.HOME = dir;
      const actionId = "cluster:format_check_failure:bun---version";
      const action = "bun --version";
      const decisionPreviewId = previewDecisionId({
        key: `self-heal:${actionId}`,
        action,
        trigger: "format cluster surfaced",
      });
      const plan: HealPlan = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectRoot: dir,
        actions: [
          {
            id: actionId,
            title: "Probe bun runtime",
            source: "cluster",
            reason: "format cluster surfaced",
            confidence: 0.9,
            command: ["bun", "--version"],
            safeToAutoApply: true,
            status: "available",
            decisionPreviewId,
            traceIds: ["trace-heal-1"],
            metadata: {
              clusterId: "cluster-1",
              clusterSize: 2,
              taxonomyId: "format_check_failure",
            },
          },
        ],
        summary: { total: 1, autoApplicable: 1, manual: 0, blocked: 0 },
      };

      const report = await Effect.runPromise(applyHealPlanEffect(plan, { yes: true, projectRoot: dir }));
      const [applied] = report.applied;
      expect(applied?.status).toBe("applied");
      expect(applied?.decisionId).toBeTruthy();

      const ledger = await readDecisionLedger();
      const preview = ledger.find((entry) => entry.decisionId === decisionPreviewId);
      expect(preview?.outcome.result).toBe("unknown");

      const followUp = ledger.find((entry) => entry.parentDecisionId === decisionPreviewId);
      expect(followUp).toBeTruthy();
      expect(followUp?.outcome.result).toBe("success");
      expect(followUp?.metadata?.status).toBe("applied");
      expect(applied?.decisionId).toBe(followUp?.decisionId);
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyHealPlan skips actions that previously failed with same key and action", async () => {
    const dir = tempDir();
    const oldHome = Bun.env.HOME;
    mkdirSync(join(dir, ".kimi-code", "var"), { recursive: true });
    try {
      Bun.env.HOME = dir;
      const actionId = "cluster:format_check_failure:bun---version";
      const action = "bun --version";
      await recordDecision({
        key: `self-heal:${actionId}`,
        actor: "kimi",
        action,
        trigger: "previous failure",
        rationale: "Previous attempt failed and should not be repeated automatically.",
        outcome: "failure",
      });

      const plan: HealPlan = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectRoot: dir,
        actions: [
          {
            id: actionId,
            title: "Probe bun runtime",
            source: "cluster",
            reason: "format cluster surfaced",
            confidence: 0.9,
            command: ["bun", "--version"],
            safeToAutoApply: true,
            status: "available",
          },
        ],
        summary: { total: 1, autoApplicable: 1, manual: 0, blocked: 0 },
      };

      const report = await Effect.runPromise(applyHealPlanEffect(plan, { yes: true, projectRoot: dir }));
      const [applied] = report.applied;
      expect(applied?.status).toBe("skipped");
      expect(applied?.reason).toContain("previous failed decision");

      const ledger = await readDecisionLedger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.outcome.result).toBe("failure");
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyHealPlan reports unknown requested action ids", async () => {
    const dir = tempDir();
    try {
      const plan: HealPlan = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectRoot: dir,
        actions: [],
        summary: { total: 0, autoApplicable: 0, manual: 0, blocked: 0 },
      };

      const report = await Effect.runPromise(applyHealPlanEffect(plan, { yes: true, actionIds: ["missing-action"] }));
      expect(report.summary.failed).toBe(1);
      expect(report.applied[0]?.status).toBe("failed");
      expect(report.applied[0]?.reason).toContain("not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
