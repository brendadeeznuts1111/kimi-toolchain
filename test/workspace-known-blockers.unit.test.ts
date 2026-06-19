import { makeDir, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  enrichWorkspaceChecksWithDecisions,
  formatKnownWorkspaceSuffix,
  LEGACY_WORKTREE_CLUSTER_ID,
  recordWorkspaceKnownBlockers,
  WORKSPACE_DECISION_TYPE,
  workspaceClusterForCheck,
} from "../src/lib/workspace-known-blockers.ts";
import {
  DECISION_SCHEMA_VERSION,
  readDecisions,
  type Decision,
} from "../src/lib/decision-ledger.ts";
import type { WorkspaceCheck } from "../src/lib/workspace-health.ts";

function check(name: string, message = "broken path"): WorkspaceCheck {
  return {
    name,
    status: "error",
    message,
    fixable: true,
  };
}

function decisionFixture(id: string, checkName: string): Decision {
  const clusterId = workspaceClusterForCheck(checkName) ?? "workspace-path-alignment";
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    decisionId: id,
    id,
    key: "config-change",
    timestamp: "2026-06-15T12:00:00.000Z",
    actor: "kimi",
    action: "config-change",
    trigger: {
      traceId: "test",
      summary: "workspace blocker trigger",
      clusterId,
      capabilityItem: checkName,
    },
    rationale: {
      summary: `Tracked recurring workspace blocker: ${checkName}`,
      fullReasoning: "test",
      evidence: [],
    },
    alternatives: [],
    alternativesConsidered: [],
    outcome: { result: "success" },
    reasoning: "test",
    childDecisionIds: [],
    metadata: {
      type: WORKSPACE_DECISION_TYPE,
      workspaceCheckName: checkName,
      workspaceClusterId: clusterId,
      lastSeenAt: "2026-06-15T12:00:00.000Z",
      seenCount: 2,
    },
  };
}

describe("workspace-known-blockers", () => {
  test("enriches workspace checks with matching decision ids", () => {
    const enriched = enrichWorkspaceChecksWithDecisions(
      [check("wrapper-coverage")],
      [decisionFixture("dec-wrapper", "wrapper-coverage")]
    );

    expect(enriched[0]?.known?.decisionIds).toEqual(["dec-wrapper"]);
    expect(formatKnownWorkspaceSuffix(enriched[0]!)).toContain("dec-wrapper");
  });

  test("links legacy recurring worktree decisions to path checks", () => {
    const legacy: Decision = {
      ...decisionFixture("dec-legacy", "repo-folder"),
      trigger: {
        traceId: "legacy",
        summary: "legacy worktree trigger",
        clusterId: LEGACY_WORKTREE_CLUSTER_ID,
      },
      metadata: { type: "manual-cleanup" },
    };
    const enriched = enrichWorkspaceChecksWithDecisions([check("repo-folder")], [legacy]);

    expect(enriched[0]?.known?.decisionIds).toEqual(["dec-legacy"]);
    expect(enriched[0]?.known?.clusterId).toBe("workspace-path-alignment");
  });

  test("does not attach broad legacy decisions to healthy checks", () => {
    const legacy: Decision = {
      ...decisionFixture("dec-legacy", "repo-folder"),
      trigger: {
        traceId: "legacy",
        summary: "legacy worktree trigger",
        clusterId: LEGACY_WORKTREE_CLUSTER_ID,
      },
      metadata: { type: "manual-cleanup" },
    };
    const healthy: WorkspaceCheck = { ...check("repo-folder"), status: "ok" };
    const enriched = enrichWorkspaceChecksWithDecisions([healthy], [legacy]);

    expect(enriched[0]?.known).toBeUndefined();
    expect(formatKnownWorkspaceSuffix(enriched[0]!)).toBe("");
  });

  test("records once and updates seen count for recurring blocker", async () => {
    const root = join(import.meta.dir, "..", `.tmp-workspace-known-${Date.now()}`);
    makeDir(root, { recursive: true });
    try {
      await recordWorkspaceKnownBlockers(root, [check("wrapper-coverage", "missing wrapper")]);
      await recordWorkspaceKnownBlockers(root, [check("wrapper-coverage", "missing wrapper")]);

      const decisions = await readDecisions(root);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.metadata?.type).toBe(WORKSPACE_DECISION_TYPE);
      expect(decisions[0]?.metadata?.workspaceCheckName).toBe("wrapper-coverage");
      expect(decisions[0]?.metadata?.seenCount).toBe(2);
      expect(decisions[0]?.outcome.result).toBe("pending");
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });
});
