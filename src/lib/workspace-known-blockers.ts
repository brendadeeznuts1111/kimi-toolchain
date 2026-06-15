/**
 * Workspace known blockers — link recurring path/workspace checks to decision context.
 */

import { rewriteNdjsonFile } from "./ndjson.ts";
import { resolveDecisionsPath } from "./decision-ledger.ts";
import { logDecision, readDecisions, type Decision } from "./decision-ledger.ts";
import type {
  WorkspaceCheck,
  WorkspaceHealthReport,
  WorkspaceKnownContext,
} from "./workspace-health.ts";

export const WORKSPACE_DECISION_TYPE = "workspace-known-blocker";
export const LEGACY_WORKTREE_CLUSTER_ID = "recurring-worktree-blockers";

const CHECK_CLUSTER: Record<string, string> = {
  "physical-folder": "workspace-path-alignment",
  "repo-folder": "workspace-path-alignment",
  "legacy-clone": "workspace-path-alignment",
  "canonical-clone": "workspace-path-alignment",
  "cursor-workspace": "workspace-path-alignment",
  "kimi-sessions": "workspace-path-alignment",
  "session-cwd": "workspace-path-alignment",
  "session-index": "workspace-path-alignment",
  snapshots: "workspace-path-alignment",
  "path-wrappers": "workspace-runtime-path",
  "wrapper-coverage": "workspace-runtime-path",
  "desktop-tools": "workspace-runtime-path",
  "kimi-binary": "workspace-kimi-binary",
};

export function workspaceClusterForCheck(checkName: string): string | undefined {
  return CHECK_CLUSTER[checkName];
}

function numberMetadata(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isWorkspaceDecision(decision: Decision, check: WorkspaceCheck): boolean {
  const checkName = check.name;
  if (decision.metadata?.type === WORKSPACE_DECISION_TYPE) {
    return decision.metadata.workspaceCheckName === checkName;
  }
  const clusterId = workspaceClusterForCheck(checkName);
  if (clusterId && decision.trigger.clusterId === clusterId) return true;
  return (
    check.status !== "ok" &&
    clusterId === "workspace-path-alignment" &&
    decision.trigger.clusterId === LEGACY_WORKTREE_CLUSTER_ID
  );
}

function contextFromDecisions(
  check: WorkspaceCheck,
  decisions: Decision[]
): WorkspaceKnownContext | undefined {
  const checkName = check.name;
  const clusterId = workspaceClusterForCheck(checkName);
  if (!clusterId) return undefined;

  const matches = decisions
    .filter((decision) => isWorkspaceDecision(decision, check))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (matches.length === 0) return undefined;

  const latest = matches[0]!;
  const seenCount = matches.reduce(
    (count, decision) => count + numberMetadata(decision.metadata?.seenCount, 1),
    0
  );
  return {
    clusterId,
    decisionIds: matches.slice(0, 3).map((decision) => decision.decisionId),
    seenCount,
    lastSeenAt: stringMetadata(latest.metadata?.lastSeenAt) ?? latest.timestamp,
    summary: latest.rationale.summary,
  };
}

export function enrichWorkspaceChecksWithDecisions(
  checks: WorkspaceCheck[],
  decisions: Decision[]
): WorkspaceCheck[] {
  return checks.map((check) => {
    const known = contextFromDecisions(check, decisions);
    return known ? { ...check, known } : check;
  });
}

export async function enrichWorkspaceReportWithDecisions(
  report: WorkspaceHealthReport,
  projectRoot: string
): Promise<WorkspaceHealthReport> {
  const decisions = await readDecisions(projectRoot);
  return {
    ...report,
    checks: enrichWorkspaceChecksWithDecisions(report.checks, decisions),
  };
}

export async function recordWorkspaceKnownBlockers(
  projectRoot: string,
  checks: WorkspaceCheck[]
): Promise<Decision[]> {
  const active = checks.filter(
    (check) => check.status !== "ok" && workspaceClusterForCheck(check.name)
  );
  if (active.length === 0) return [];

  const decisions = await readDecisions(projectRoot);
  const now = new Date().toISOString();
  const updated: Decision[] = [];
  let mutated = false;

  for (const check of active) {
    const clusterId = workspaceClusterForCheck(check.name)!;
    const index = decisions.findIndex(
      (decision) =>
        decision.metadata?.type === WORKSPACE_DECISION_TYPE &&
        decision.metadata.workspaceCheckName === check.name
    );

    if (index >= 0) {
      const current = decisions[index]!;
      const seenCount = numberMetadata(current.metadata?.seenCount, 1) + 1;
      const next: Decision = {
        ...current,
        outcome: {
          result: "pending",
          verifiedAt: now,
          proof: {
            type: "health-probe",
            detail: check.message,
          },
        },
        metadata: {
          ...current.metadata,
          currentStatus: check.status,
          fixable: check.fixable,
          lastMessage: check.message,
          lastSeenAt: now,
          seenCount,
          workspaceClusterId: clusterId,
        },
      };
      decisions[index] = next;
      updated.push(next);
      mutated = true;
      continue;
    }

    const created = await logDecision(
      {
        action: "config-change",
        trigger: {
          traceId: `workspace-${check.name}`,
          clusterId,
          capabilityItem: check.name,
        },
        rationaleOverride: {
          summary: `Tracked recurring workspace blocker: ${check.name}`,
          fullReasoning: `Workspace check \`${check.name}\` is non-ok (${check.status}): ${check.message}. This is tracked as known context because path/workspace drift has caused late failures before.`,
          evidence: [{ type: "error", detail: check.message }],
        },
        alternatives: [
          {
            action: "workspace-fix",
            feasibility: check.fixable ? "high" : "medium",
            reason: check.autoFix ?? "Use workspace doctor output to repair alignment",
          },
          {
            action: "ignore",
            feasibility: "low",
            reason: "Recurring path drift tends to fail later gates",
          },
        ],
        outcome: {
          result: "pending",
          verifiedAt: now,
          proof: { type: "health-probe", detail: check.message },
        },
        metadata: {
          type: WORKSPACE_DECISION_TYPE,
          workspaceCheckName: check.name,
          workspaceClusterId: clusterId,
          currentStatus: check.status,
          firstSeenAt: now,
          lastSeenAt: now,
          lastMessage: check.message,
          fixable: check.fixable,
          seenCount: 1,
        },
      },
      { projectRoot }
    );
    updated.push(created);
  }

  if (mutated) {
    const path = await resolveDecisionsPath(projectRoot);
    const merged = await readDecisions(projectRoot);
    const byId = new Map(merged.map((decision) => [decision.decisionId, decision]));
    for (const decision of decisions) byId.set(decision.decisionId, decision);
    await rewriteNdjsonFile(
      path,
      [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    );
  }

  return updated;
}

export function formatKnownWorkspaceSuffix(check: WorkspaceCheck): string {
  if (check.status === "ok") return "";
  if (!check.known || check.known.decisionIds.length === 0) return "";
  const count = check.known.seenCount > 1 ? ` x${check.known.seenCount}` : "";
  return ` [known ${check.known.clusterId}: ${check.known.decisionIds.join(", ")}${count}]`;
}
