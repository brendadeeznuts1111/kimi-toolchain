/**
 * Self-healing planner for surfacing safe local repair actions.
 *
 * The planner converts exposed signals (capabilities + clustered failures) into
 * an explicit action plan. Applying the plan is dry-run by default; only actions
 * marked safeToAutoApply are eligible for execution.
 */

import { Effect } from "effect";
import { readableStreamToText } from "./bun-utils.ts";
import {
  runCapabilityAggregator,
  type CapabilityReport,
  type CapabilityResult,
} from "./capabilities.ts";
import {
  clusterFailureLedgerEffect,
  type ErrorCluster,
  type ErrorClusterReport,
} from "./error-clustering.ts";
import {
  previewDecisionId,
  queryDecisionLedger,
  recordDecision,
  type DecisionRecord,
} from "./decision-ledger.ts";
import type { RationaleBuildContext } from "./decision-rationale.ts";

export type HealActionStatus = "available" | "manual" | "blocked";
export type HealActionSource = "capability" | "cluster" | "contract" | "governance";
export type AppliedHealActionStatus = "dry-run" | "applied" | "failed" | "skipped";

export interface HealAction {
  id: string;
  title: string;
  source: HealActionSource;
  reason: string;
  confidence: number;
  command?: string[];
  safeToAutoApply: boolean;
  status: HealActionStatus;
  requiresApproval?: boolean;
  traceIds?: string[];
  decisionPreviewId?: string;
  metadata?: Record<string, unknown>;
}

export interface HealPlan {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  actions: HealAction[];
  summary: {
    total: number;
    autoApplicable: number;
    manual: number;
    blocked: number;
  };
}

export interface BuildHealPlanOptions {
  clusters?: ErrorClusterReport;
  capabilities?: CapabilityReport;
  threshold?: number;
  generatedAt?: string;
}

export interface ApplyHealPlanOptions {
  projectRoot?: string;
  dryRun?: boolean;
  yes?: boolean;
  actionIds?: string[];
  maxOutputBytes?: number;
}

export interface AppliedHealAction {
  id: string;
  title: string;
  status: AppliedHealActionStatus;
  decisionId?: string;
  command?: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  reason?: string;
}

export interface HealApplyReport {
  schemaVersion: 1;
  generatedAt: string;
  dryRun: boolean;
  plan: HealPlan;
  applied: AppliedHealAction[];
  summary: {
    attempted: number;
    applied: number;
    failed: number;
    skipped: number;
  };
}

interface ClusterPlaybook {
  title: string;
  reason: string;
  command?: string[];
  safeToAutoApply: boolean;
  status: HealActionStatus;
  confidence: number;
  source?: HealActionSource;
}

const CLUSTER_PLAYBOOKS: Record<string, ClusterPlaybook> = {
  format_check_failure: {
    title: "Review repository formatting",
    reason:
      "Formatting failures are deterministic, but applying the formatter changes source files and requires human review.",
    command: ["bun", "run", "format"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.95,
  },
  timeout_hang: {
    title: "Inspect orphan processes after timeout cluster",
    reason:
      "Timeout clusters often come from stale subprocesses; start with a non-mutating orphan audit.",
    command: ["bun", "run", "src/bin/kimi-orphan-kill.ts", "--dry-run"],
    safeToAutoApply: true,
    status: "available",
    confidence: 0.82,
  },
  orphan_process: {
    title: "Inspect orphan processes",
    reason: "The taxonomy identified orphan process evidence; use dry-run cleanup first.",
    command: ["bun", "run", "src/bin/kimi-orphan-kill.ts", "--dry-run"],
    safeToAutoApply: true,
    status: "available",
    confidence: 0.84,
  },
  lockfile_issue: {
    title: "Review lockfile integrity",
    reason:
      "Guardian lockfile repairs may update trust baselines and need an explicit human decision.",
    command: ["bun", "run", "src/bin/kimi-guardian.ts", "check"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.88,
  },
  command_not_found: {
    title: "Install or restore missing toolchain dependencies",
    reason:
      "Dependency installation mutates the workspace and should be approved before execution.",
    command: ["bun", "install"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.78,
  },
  typecheck_failure: {
    title: "Run focused typecheck diagnostics",
    reason:
      "Type errors need source changes; rerun the typecheck and inspect the exact diagnostics.",
    command: ["bun", "run", "typecheck"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.76,
  },
  lint_failure: {
    title: "Run lint diagnostics",
    reason: "Lint failures may require source changes, banned-term edits, or pattern updates.",
    command: ["bun", "run", "lint"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.74,
  },
  test_failure: {
    title: "Run focused test diagnostics",
    reason:
      "Test failures need the failing assertion and impacted source before a safe repair exists.",
    command: ["bun", "test"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.7,
  },
  max_steps_exceeded: {
    title: "Switch validation to the fast gate",
    reason:
      "Step-limit clusters indicate the agent should batch edits and use the fast gate first.",
    command: ["bun", "run", "check:fast"],
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.72,
    source: "governance",
  },
};

export function buildHealPlanEffect(
  projectRoot: string,
  options: BuildHealPlanOptions = {}
): Effect.Effect<HealPlan, never> {
  return Effect.gen(function* () {
    const clustersEffect = options.clusters
      ? Effect.succeed(options.clusters)
      : clusterFailureLedgerEffect({ threshold: options.threshold }).pipe(
          Effect.catchAll(() => Effect.succeed(emptyClusterReport(options.threshold)))
        );
    const capabilitiesEffect = options.capabilities
      ? Effect.succeed(options.capabilities)
      : runCapabilityAggregator(projectRoot, { saveSnapshot: false, recordDecisions: false }).pipe(
          Effect.catchAll(() => Effect.succeed(emptyCapabilityReport()))
        );

    const [clusters, capabilities] = yield* Effect.all([clustersEffect, capabilitiesEffect], {
      concurrency: 2,
    });
    const actions = sortActions(
      dedupeActions([
        ...actionsFromCapabilities(capabilities),
        ...actionsFromClusters(clusters.clusters),
      ]).map(withDecisionPreview)
    );

    return {
      schemaVersion: 1,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      projectRoot,
      actions,
      summary: summarizeActions(actions),
    };
  });
}

export function applyHealPlanEffect(
  plan: HealPlan,
  options: ApplyHealPlanOptions = {}
): Effect.Effect<HealApplyReport, never> {
  return Effect.gen(function* () {
    const dryRun = options.dryRun ?? !options.yes;
    const actionIds = new Set(options.actionIds ?? []);
    const selected =
      actionIds.size === 0
        ? plan.actions
        : plan.actions.filter((action) => actionIds.has(action.id));
    const missing = [...actionIds].filter((id) => !plan.actions.some((action) => action.id === id));
    const missingActions: AppliedHealAction[] = missing.map((id) => ({
      id,
      title: "Unknown heal action",
      status: "failed",
      reason: "requested action id was not found in the heal plan",
    }));
    const appliedSelected = yield* Effect.all(
      selected.map((action) => applyOneAction(action, plan, { ...options, dryRun })),
      { concurrency: 1 }
    );
    const applied = [...appliedSelected, ...missingActions];

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dryRun,
      plan,
      applied,
      summary: {
        attempted: applied.filter((item) => item.status === "applied" || item.status === "failed")
          .length,
        applied: applied.filter((item) => item.status === "applied").length,
        failed: applied.filter((item) => item.status === "failed").length,
        skipped: applied.filter((item) => item.status === "skipped" || item.status === "dry-run")
          .length,
      },
    };
  });
}

function actionsFromCapabilities(report: CapabilityReport): HealAction[] {
  const actions: HealAction[] = [];
  for (const check of report.checks) {
    if (check.status === "healthy") continue;
    const action = actionFromCapability(check);
    if (action) actions.push(action);
  }
  return actions;
}

function actionFromCapability(check: CapabilityResult): HealAction | null {
  if (check.id === "mcp-config") {
    return {
      id: "capability:mcp-config:doctor-fix",
      title: "Repair MCP config registration",
      source: "capability",
      reason: check.summary,
      confidence: 0.94,
      command: ["bun", "run", "doctor", "--fix", "--quick"],
      safeToAutoApply: true,
      status: "available",
      metadata: { check },
    };
  }

  if (check.id === "failure-ledger-hook") {
    return {
      id: "capability:failure-ledger-hook:doctor-fix",
      title: "Repair failure ledger hook wiring",
      source: "capability",
      reason: check.summary,
      confidence: 0.9,
      command: ["bun", "run", "doctor", "--fix", "--quick"],
      safeToAutoApply: true,
      status: "available",
      metadata: { check },
    };
  }

  if (check.id === "contract-trust") {
    const invalid = numberFromAudit(check, "invalid");
    const unknownKeys = numberFromAudit(check, "unknownKeys");
    const unsigned = numberFromAudit(check, "unsigned");
    return {
      id: "capability:contract-trust:review",
      title: invalid > 0 ? "Investigate invalid contract signatures" : "Upgrade unsigned contracts",
      source: "contract",
      reason:
        invalid > 0
          ? `${check.summary}; invalid signatures are security blockers.`
          : `${check.summary}; unsigned or unknown-key contracts remain allowed but untrusted.`,
      confidence: invalid > 0 ? 0.96 : 0.82,
      command: ["bun", "run", "contract", "validate", invalid > 0 ? "--strict" : "--json"],
      safeToAutoApply: false,
      status: invalid > 0 ? "blocked" : "manual",
      requiresApproval: true,
      metadata: { invalid, unknownKeys, unsigned, check },
    };
  }

  if (check.id === "credential-provider-env") {
    return {
      id: "capability:credential-provider-env:configure",
      title: "Configure optional credential providers",
      source: "capability",
      reason: check.summary,
      confidence: 0.48,
      safeToAutoApply: false,
      status: "manual",
      metadata: { check },
    };
  }

  return {
    id: `capability:${check.id}:review`,
    title: `Review ${check.id}`,
    source: "capability",
    reason: check.summary,
    confidence: 0.55,
    safeToAutoApply: false,
    status: check.status === "unavailable" ? "blocked" : "manual",
    metadata: { check },
  };
}

function actionsFromClusters(clusters: ErrorCluster[]): HealAction[] {
  return clusters.map(actionFromCluster);
}

function actionFromCluster(cluster: ErrorCluster): HealAction {
  const taxonomyId = dominantTaxonomy(cluster);
  const inferred = inferPlaybook(cluster, taxonomyId);
  const confidence = clamp((cluster.confidence + inferred.confidence) / 2);
  const traceIds = cluster.members
    .map((member) => member.traceId)
    .filter((traceId): traceId is string => !!traceId);

  return {
    id:
      inferred.safeToAutoApply || inferred.command
        ? `cluster:${taxonomyId}:${commandKey(inferred.command)}`
        : `cluster:${cluster.id}:review`,
    title: inferred.title,
    source: inferred.source ?? "cluster",
    reason: `${inferred.reason} Evidence: ${cluster.label} (${cluster.size} failure(s)).`,
    confidence,
    command: inferred.command,
    safeToAutoApply: inferred.safeToAutoApply,
    status: inferred.status,
    requiresApproval: !inferred.safeToAutoApply,
    traceIds,
    metadata: {
      clusterId: cluster.id,
      clusterSize: cluster.size,
      taxonomyId,
      tools: cluster.tools,
      taxonomyCounts: cluster.taxonomyCounts,
      suggestedFix: cluster.suggestedFix,
      autoFix: cluster.autoFix,
    },
  };
}

function inferPlaybook(cluster: ErrorCluster, taxonomyId: string): ClusterPlaybook {
  const direct = CLUSTER_PLAYBOOKS[taxonomyId];
  if (direct) return direct;

  const text = [
    cluster.label,
    cluster.suggestedFix,
    cluster.autoFix,
    ...cluster.members.map((member) => member.output),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (text.includes("[object object]")) {
    return {
      title: "Sync improved failure hook serialization",
      reason:
        "The failure ledger contains object stringification; the current hook preserves structured error evidence.",
      command: ["bun", "run", "sync"],
      safeToAutoApply: true,
      status: "available",
      confidence: 0.86,
    };
  }

  if (text.includes("mcp") && text.includes("unified-shell")) {
    return {
      title: "Repair MCP config registration",
      reason: "Failure evidence mentions MCP/unified-shell wiring.",
      command: ["bun", "run", "doctor", "--fix", "--quick"],
      safeToAutoApply: true,
      status: "available",
      confidence: 0.88,
    };
  }

  if (text.includes("timeout") || text.includes("timed out")) {
    return CLUSTER_PLAYBOOKS.timeout_hang;
  }

  if (text.includes("lockfile") || text.includes("bun.lock")) {
    return CLUSTER_PLAYBOOKS.lockfile_issue;
  }

  return {
    title: "Classify unknown failure cluster",
    reason:
      "No safe repair playbook matched this cluster; add taxonomy coverage before automation.",
    safeToAutoApply: false,
    status: "manual",
    confidence: 0.45,
  };
}

function applyOneAction(
  action: HealAction,
  plan: HealPlan,
  options: ApplyHealPlanOptions & { dryRun: boolean }
): Effect.Effect<AppliedHealAction, never> {
  if (action.status !== "available") {
    return Effect.succeed({
      id: action.id,
      title: action.title,
      status: "skipped",
      command: action.command,
      reason: `action is ${action.status}`,
    });
  }
  if (!action.safeToAutoApply) {
    return Effect.succeed({
      id: action.id,
      title: action.title,
      status: "skipped",
      command: action.command,
      reason: "action is not marked safeToAutoApply",
    });
  }
  if (!action.command || action.command.length === 0) {
    return Effect.succeed({
      id: action.id,
      title: action.title,
      status: "skipped",
      reason: "action has no command",
    });
  }
  if (options.dryRun) {
    return Effect.succeed({
      id: action.id,
      title: action.title,
      status: "dry-run",
      decisionId: action.decisionPreviewId,
      command: action.command,
      reason: "dry-run; pass --yes to apply safe actions",
    });
  }

  return Effect.tryPromise({
    try: async () => {
      const priorFailure = await findPriorFailedPlaybook(action);
      if (priorFailure) {
        return {
          id: action.id,
          title: action.title,
          status: "skipped" as const,
          command: action.command,
          reason: `previous failed decision ${priorFailure.decisionId}; refusing to re-apply without manual intervention`,
          decisionId: priorFailure.decisionId,
        };
      }

      const preDecisionId = await recordHealPreviewDecision(action);
      const started = performance.now();
      try {
        const result = await runCommand(action.command!, options.projectRoot ?? plan.projectRoot, {
          maxOutputBytes: options.maxOutputBytes,
          actionId: action.id,
        });
        const applied: AppliedHealAction = {
          id: action.id,
          title: action.title,
          status: result.exitCode === 0 ? "applied" : "failed",
          command: action.command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: Math.round(performance.now() - started),
        };
        const followUpDecisionId = await recordHealOutcomeDecision(action, applied, preDecisionId);
        return {
          ...applied,
          decisionId: followUpDecisionId ?? preDecisionId,
        };
      } catch (error) {
        const applied: AppliedHealAction = {
          id: action.id,
          title: action.title,
          status: "failed",
          command: action.command,
          reason: error instanceof Error ? error.message : Bun.inspect(error),
          durationMs: Math.round(performance.now() - started),
        };
        const followUpDecisionId = await recordHealOutcomeDecision(action, applied, preDecisionId);
        return {
          ...applied,
          decisionId: followUpDecisionId ?? preDecisionId,
        };
      }
    },
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        id: action.id,
        title: action.title,
        status: "failed" as const,
        decisionId: action.decisionPreviewId,
        command: action.command,
        reason: error instanceof Error ? error.message : Bun.inspect(error),
      })
    )
  );
}

async function runCommand(
  command: string[],
  cwd: string,
  options: { maxOutputBytes?: number; actionId: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, KIMI_HEAL_ACTION_ID: options.actionId },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readLimited(proc.stdout, options.maxOutputBytes ?? 64_000),
    readLimited(proc.stderr, options.maxOutputBytes ?? 64_000),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<string> {
  if (!stream) return "";
  const text = await readableStreamToText(stream);
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n[truncated ${text.length - maxBytes} chars]`;
}

async function recordHealPreviewDecision(action: HealAction): Promise<string | undefined> {
  try {
    const priorSuccessDecisionIds = await priorSuccessDecisions(action);
    const preview = await recordDecision({
      decisionId: action.decisionPreviewId,
      key: actionDecisionKey(action),
      actor: "kimi",
      action: actionDecisionAction(action),
      trigger: action.reason,
      triggerContext: {
        summary: action.reason,
        clusterId:
          typeof action.metadata?.clusterId === "string" ? action.metadata.clusterId : undefined,
        traceId: action.traceIds?.[0],
      },
      clusterId:
        typeof action.metadata?.clusterId === "string" ? action.metadata.clusterId : undefined,
      rationaleContext: healRationaleContext(action, priorSuccessDecisionIds) ?? {
        kind: "generic",
        summary: "Previewed self-heal action before execution.",
        fullReasoning:
          "Self-healing records an unknown-outcome decision before executing safeToAutoApply actions.",
      },
      alternativesConsidered: ["review manually", "run kimi-heal apply without --yes as a dry run"],
      outcome: "unknown",
      metadata: {
        phase: "preview",
        source: action.source,
        confidence: action.confidence,
        traceIds: action.traceIds,
        plannedDecisionId: action.decisionPreviewId,
      },
    });
    return preview.decisionId;
  } catch {
    // Self-healing should not fail because the explanatory ledger is unavailable.
    return action.decisionPreviewId;
  }
}

async function recordHealOutcomeDecision(
  action: HealAction,
  applied: AppliedHealAction,
  parentDecisionId?: string
): Promise<string | undefined> {
  try {
    const priorSuccessDecisionIds = await priorSuccessDecisions(action);
    const recorded = await recordDecision({
      key: actionDecisionKey(action),
      actor: "kimi",
      action: actionDecisionAction(action),
      trigger: action.reason,
      triggerContext: {
        summary: action.reason,
        clusterId:
          typeof action.metadata?.clusterId === "string" ? action.metadata.clusterId : undefined,
        traceId: action.traceIds?.[0],
      },
      clusterId:
        typeof action.metadata?.clusterId === "string" ? action.metadata.clusterId : undefined,
      rationaleContext: healRationaleContext(action, priorSuccessDecisionIds) ?? {
        kind: "generic",
        summary: "Recorded self-heal execution outcome.",
        fullReasoning:
          "Self-healing appends outcome decisions after action execution without mutating previous ledger lines.",
      },
      alternativesConsidered: ["review manually", "run kimi-heal apply without --yes as a dry run"],
      outcome:
        applied.status === "applied"
          ? "success"
          : applied.status === "failed"
            ? "failure"
            : "unknown",
      parentDecisionId,
      metadata: {
        phase: "result",
        source: action.source,
        confidence: action.confidence,
        traceIds: action.traceIds,
        exitCode: applied.exitCode,
        status: applied.status,
        plannedDecisionId: action.decisionPreviewId,
      },
    });
    return recorded.decisionId;
  } catch {
    return parentDecisionId;
  }
}

function withDecisionPreview(action: HealAction): HealAction {
  return {
    ...action,
    decisionPreviewId: previewDecisionId({
      key: `self-heal:${action.id}`,
      action: action.command?.join(" ") ?? action.title,
      trigger: action.reason,
    }),
  };
}

function dedupeActions(actions: HealAction[]): HealAction[] {
  const byId = new Map<string, HealAction>();
  for (const action of actions) {
    const existing = byId.get(action.id);
    if (!existing) {
      byId.set(action.id, action);
      continue;
    }
    byId.set(action.id, {
      ...existing,
      confidence: Math.max(existing.confidence, action.confidence),
      reason: mergeReason(existing.reason, action.reason),
      traceIds: [...new Set([...(existing.traceIds ?? []), ...(action.traceIds ?? [])])],
      metadata: {
        ...existing.metadata,
        mergedEvidence: [...asArray(existing.metadata?.mergedEvidence), action.metadata],
      },
    });
  }
  return [...byId.values()];
}

function sortActions(actions: HealAction[]): HealAction[] {
  const statusRank: Record<HealActionStatus, number> = {
    available: 0,
    manual: 1,
    blocked: 2,
  };
  return actions.sort(
    (a, b) =>
      Number(b.safeToAutoApply) - Number(a.safeToAutoApply) ||
      statusRank[a.status] - statusRank[b.status] ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id)
  );
}

function summarizeActions(actions: HealAction[]): HealPlan["summary"] {
  return {
    total: actions.length,
    autoApplicable: actions.filter(
      (action) => action.safeToAutoApply && action.status === "available"
    ).length,
    manual: actions.filter((action) => action.status === "manual").length,
    blocked: actions.filter((action) => action.status === "blocked").length,
  };
}

function dominantTaxonomy(cluster: ErrorCluster): string {
  const entries = Object.entries(cluster.taxonomyCounts);
  if (entries.length === 0) return "unknown";
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0][0] || "unknown";
}

function numberFromAudit(check: CapabilityResult, key: string): number {
  const audit = check.details?.audit;
  if (!audit || typeof audit !== "object") return 0;
  const value = (audit as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

function commandKey(command: string[] | undefined): string {
  return command?.join("_").replace(/[^a-z0-9_-]+/gi, "-") || "review";
}

function mergeReason(a: string, b: string): string {
  return a.includes(b) ? a : `${a} Additional evidence: ${b}`;
}

function actionDecisionKey(action: HealAction): string {
  return `self-heal:${action.id}`;
}

function actionDecisionAction(action: HealAction): string {
  return action.command?.join(" ") ?? action.title;
}

async function findPriorFailedPlaybook(action: HealAction): Promise<DecisionRecord | undefined> {
  const actionLabel = actionDecisionAction(action);
  const key = actionDecisionKey(action);
  const failures = await queryDecisionLedger({
    action: actionLabel,
    outcome: "failure",
    limit: 25,
  });
  return failures.find((decision) => decision.key === key);
}

async function priorSuccessDecisions(action: HealAction): Promise<string[]> {
  const actionLabel = actionDecisionAction(action);
  const key = actionDecisionKey(action);
  const successes = await queryDecisionLedger({
    action: actionLabel,
    outcome: "success",
    limit: 25,
  });
  return successes
    .filter((decision) => decision.key === key)
    .map((decision) => decision.decisionId);
}

function healRationaleContext(
  action: HealAction,
  priorSuccessDecisionIds: string[]
): RationaleBuildContext | undefined {
  const clusterId =
    typeof action.metadata?.clusterId === "string" ? action.metadata.clusterId : undefined;
  const topTaxonomy =
    typeof action.metadata?.taxonomyId === "string" ? action.metadata.taxonomyId : undefined;
  const traceId = action.traceIds?.[0];
  if (!clusterId || !topTaxonomy || !traceId) return undefined;
  const clusterSize =
    typeof action.metadata?.clusterSize === "number"
      ? action.metadata.clusterSize
      : Math.max(1, action.traceIds?.length ?? 1);
  return {
    kind: "heal",
    playbookTitle: action.title,
    clusterId,
    clusterSize,
    topTaxonomy,
    traceId,
    priorSuccessCount: priorSuccessDecisionIds.length,
    priorDecisionIds: priorSuccessDecisionIds.slice(0, 5),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function emptyClusterReport(threshold?: number): ErrorClusterReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    threshold: threshold ?? 0.42,
    totalFailures: 0,
    clusters: [],
    summaries: [],
  };
}

function emptyCapabilityReport(): CapabilityReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readiness: 100,
    readinessScore: 100,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    checks: [],
  };
}
