/**
 * Decision Ledger — active justification engine with linked evidence and rationale generation.
 * Persists to {projectRoot}/.kimi/decisions.ndjson (v2). Reads legacy v1 JSONL for compat.
 */

import { Effect } from "effect";
import { join } from "path";
import { appendNdjsonRecord, readNdjsonFile, rewriteNdjsonFile } from "./ndjson.ts";
import { decisionLedgerPath, decisionsNdjsonPath, homeDir } from "./paths.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { readFailureTraceRecords, readTraceEvents } from "./trace-ledger.ts";
import { readClusterMetadata } from "./failure-ledger.ts";
import { resolveProjectRoot } from "./utils.ts";
import { safeParse, sha256String } from "./utils.ts";

export const DECISION_SCHEMA_VERSION = 2;

export type DecisionActor = "kimi" | "user" | "ci";

export type DecisionAction =
  | "heal"
  | "contract-sign"
  | "hook-register"
  | "config-change"
  | "capability-degrade";

export type DecisionOutcomeResult = "success" | "failure" | "unknown" | "pending" | "skipped";

export type DecisionEvidenceType = "traceStep" | "error" | "contractDiff" | "cluster" | "decision";

export interface DecisionEvidence {
  type: DecisionEvidenceType;
  traceId?: string;
  stepIndex?: number;
  errorId?: string;
  oldHash?: string;
  newHash?: string;
  clusterId?: string;
  decisionId?: string;
  detail?: string;
}

export interface DecisionAlternative {
  action: string;
  feasibility: "low" | "medium" | "high";
  reason?: string;
}

export interface DecisionOutcomeProof {
  type: "cluster-dissolved" | "capability-restored" | "drift-resolved" | "health-probe" | "manual";
  detail: string;
}

export interface DecisionOutcome {
  result: DecisionOutcomeResult;
  verifiedAt?: string;
  proof?: DecisionOutcomeProof;
}

export interface DecisionTrigger {
  traceId: string;
  clusterId?: string;
  contractFile?: string;
  hookName?: string;
  capabilityItem?: string;
  errorId?: string;
}

export interface DecisionRationale {
  summary: string;
  fullReasoning: string;
  evidence: DecisionEvidence[];
}

export interface Decision {
  schemaVersion: typeof DECISION_SCHEMA_VERSION;
  decisionId: string;
  timestamp: string;
  actor: DecisionActor;
  action: DecisionAction;
  trigger: DecisionTrigger;
  rationale: DecisionRationale;
  alternatives: DecisionAlternative[];
  outcome: DecisionOutcome;
  parentDecisionId?: string;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
}

/** Legacy v1 shape — read-only compat from ~/.kimi-code/var/decision-ledger.jsonl */
export interface LegacyDecisionRecord {
  schemaVersion: 1;
  id: string;
  key: string;
  action: string;
  trigger: string;
  reasoning: string;
  alternatives: string[];
  outcome: string;
  timestamp: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionInput {
  action: DecisionAction;
  trigger: DecisionTrigger;
  actor?: DecisionActor;
  parentDecisionId?: string;
  alternatives?: DecisionAlternative[];
  outcome?: DecisionOutcome;
  metadata?: Record<string, unknown>;
  /** Override auto-generated rationale */
  rationaleOverride?: Partial<DecisionRationale>;
}

export interface DecisionGraphNode {
  decision: Decision;
  children: DecisionGraphNode[];
}

export interface DecisionGraph {
  traceId: string;
  roots: DecisionGraphNode[];
  nodes: Decision[];
  edges: Array<{ from: string; to: string }>;
}

export interface DecisionSuggestion {
  decisionId: string;
  action: DecisionAction;
  confidence: number;
  qualityScore: number;
  summary: string;
  playbookId?: string;
  clusterId?: string;
}

export interface RationaleContext {
  projectRoot: string;
  playbookId?: string;
  clusterCount?: number;
  priorSuccessDecisionIds?: string[];
  contractDiff?: { file: string; oldHash: string; newHash: string };
  capabilityDetail?: string;
}

function isDecision(value: unknown): value is Decision {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Decision).schemaVersion === DECISION_SCHEMA_VERSION &&
    typeof (value as Decision).decisionId === "string"
  );
}

function isLegacyDecision(value: unknown): value is LegacyDecisionRecord {
  return (
    !!value &&
    typeof value === "object" &&
    (value as LegacyDecisionRecord).schemaVersion === 1 &&
    typeof (value as LegacyDecisionRecord).id === "string"
  );
}

export function resolveDecisionActor(): DecisionActor {
  if (Bun.env.CI || Bun.env.GITHUB_ACTIONS || Bun.env.GITLAB_CI) return "ci";
  if (Bun.env.KIMI_USER_DECISION === "1") return "user";
  return "kimi";
}

export async function resolveDecisionsPath(projectRoot?: string): Promise<string> {
  if (projectRoot) return decisionsNdjsonPath(projectRoot);
  const cwdPath = decisionsNdjsonPath(Bun.cwd);
  if (await Bun.file(cwdPath).exists()) return cwdPath;
  const root = await resolveProjectRoot(Bun.cwd);
  return decisionsNdjsonPath(root);
}

export async function resolveDecisionsRoot(projectRoot?: string): Promise<string> {
  if (projectRoot) return projectRoot;
  const cwdPath = decisionsNdjsonPath(Bun.cwd);
  if (await Bun.file(cwdPath).exists()) return Bun.cwd;
  return resolveProjectRoot(Bun.cwd);
}

function createDecisionId(input: {
  action: DecisionAction;
  traceId: string;
  timestamp: string;
}): string {
  return `dec-${sha256String(JSON.stringify(input)).slice(0, 16)}`;
}

export function defaultAlternativesForAction(action: DecisionAction): DecisionAlternative[] {
  switch (action) {
    case "heal":
      return [
        { action: "manual-fix", feasibility: "low", reason: "Operator handles root cause" },
        { action: "rollback-contract", feasibility: "medium", reason: "Revert signed baseline" },
        { action: "defer", feasibility: "high", reason: "Wait for more cluster evidence" },
      ];
    case "contract-sign":
      return [
        { action: "drift-heal", feasibility: "medium", reason: "Regenerate without signing" },
        { action: "ignore-drift", feasibility: "low", reason: "Accept temporary mismatch" },
      ];
    case "hook-register":
      return [{ action: "skip-hooks", feasibility: "medium", reason: "Install later manually" }];
    case "config-change":
      return [{ action: "keep-current", feasibility: "high", reason: "No config mutation" }];
    case "capability-degrade":
      return [
        { action: "force-retry", feasibility: "medium", reason: "Retry capability probe" },
        { action: "disable-service", feasibility: "low", reason: "Remove from manifest" },
      ];
    default:
      return [];
  }
}

export function generateRationaleEffect(
  input: DecisionInput,
  context: RationaleContext
): Effect.Effect<DecisionRationale, never> {
  return Effect.tryPromise({
    try: () => generateRationale(input, context),
    catch: () => "rationale-failed",
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        summary: `${input.action} on trace ${input.trigger.traceId}`,
        fullReasoning: `Automated ${input.action} for trace ${input.trigger.traceId}.`,
        evidence: [{ type: "traceStep" as const, traceId: input.trigger.traceId }],
      })
    )
  );
}

export async function generateRationale(
  input: DecisionInput,
  context: RationaleContext
): Promise<DecisionRationale> {
  if (input.rationaleOverride?.summary && input.rationaleOverride.fullReasoning) {
    return {
      summary: input.rationaleOverride.summary,
      fullReasoning: input.rationaleOverride.fullReasoning,
      evidence: input.rationaleOverride.evidence ?? [],
    };
  }

  const evidence: DecisionEvidence[] = [{ type: "traceStep", traceId: input.trigger.traceId }];
  if (input.trigger.errorId) evidence.push({ type: "error", errorId: input.trigger.errorId });
  if (input.trigger.clusterId) {
    evidence.push({ type: "cluster", clusterId: input.trigger.clusterId });
  }
  if (context.contractDiff) {
    evidence.push({
      type: "contractDiff",
      oldHash: context.contractDiff.oldHash,
      newHash: context.contractDiff.newHash,
      detail: context.contractDiff.file,
    });
  }
  for (const priorId of context.priorSuccessDecisionIds ?? []) {
    evidence.push({ type: "decision", decisionId: priorId });
  }

  let summary = "";
  let fullReasoning = "";

  switch (input.action) {
    case "heal": {
      const playbook = context.playbookId ?? "auto-heal";
      const cluster = input.trigger.clusterId ?? "unclustered";
      const count = context.clusterCount ?? 0;
      const priors = context.priorSuccessDecisionIds ?? [];
      const priorText =
        priors.length > 0
          ? ` This playbook resolved the same cluster successfully ${priors.length} time(s) before (${priors.slice(0, 3).join(", ")}).`
          : "";
      summary = `Applied playbook ${playbook} for cluster ${cluster}`;
      fullReasoning =
        `Applied playbook \`${playbook}\` because error cluster \`${cluster}\` had ${count} occurrence(s) in trace \`${input.trigger.traceId}\`, and automated heal was deemed safe.${priorText}`.trim();
      break;
    }
    case "contract-sign": {
      const file = input.trigger.contractFile ?? context.contractDiff?.file ?? "contract";
      summary = `Re-signed contract ${file} after drift detection`;
      fullReasoning = context.contractDiff
        ? `Contract \`${file}\` was re-signed because drift was detected (hash ${context.contractDiff.oldHash.slice(0, 8)} → ${context.contractDiff.newHash.slice(0, 8)}). No breaking changes assumed for consumers.`
        : `Contract \`${file}\` was re-signed to baseline intentional drift on trace \`${input.trigger.traceId}\`.`;
      break;
    }
    case "hook-register": {
      const hook = input.trigger.hookName ?? "git-hooks";
      summary = `Registered hook ${hook}`;
      fullReasoning = `Registered \`${hook}\` to enforce local quality gates before commit/push (trace \`${input.trigger.traceId}\`).`;
      break;
    }
    case "config-change": {
      summary = `Updated toolchain configuration`;
      fullReasoning = `Configuration change recorded on trace \`${input.trigger.traceId}\`${input.trigger.capabilityItem ? ` affecting \`${input.trigger.capabilityItem}\`` : ""}.`;
      break;
    }
    case "capability-degrade": {
      const item = input.trigger.capabilityItem ?? "service";
      summary = `Degraded capability ${item}`;
      fullReasoning =
        context.capabilityDetail ??
        `Service \`${item}\` downgraded to degraded because probe failed or credential is expiring. Full validation deferred (trace \`${input.trigger.traceId}\`).`;
      break;
    }
    default:
      summary = `${input.action} recorded`;
      fullReasoning = `Recorded ${input.action} for trace ${input.trigger.traceId}.`;
  }

  return {
    summary: input.rationaleOverride?.summary ?? summary,
    fullReasoning: input.rationaleOverride?.fullReasoning ?? fullReasoning,
    evidence: input.rationaleOverride?.evidence ?? evidence,
  };
}

export async function logDecision(
  input: DecisionInput,
  options: { projectRoot?: string; context?: RationaleContext } = {}
): Promise<Decision> {
  const projectRoot = options.projectRoot ?? (await resolveDecisionsRoot());
  const path = await resolveDecisionsPath(projectRoot);
  const trace = ensureProcessTrace();
  const timestamp = new Date().toISOString();
  const trigger: DecisionTrigger = {
    ...input.trigger,
    traceId: input.trigger.traceId || trace.traceId,
  };

  const priorSuccess = input.trigger.clusterId
    ? (await readDecisions(projectRoot))
        .filter(
          (d) =>
            d.trigger.clusterId === input.trigger.clusterId &&
            d.outcome.result === "success" &&
            (d.qualityScore ?? 0) >= 0.7
        )
        .map((d) => d.decisionId)
        .slice(0, 5)
    : [];

  const context: RationaleContext = {
    projectRoot,
    playbookId: (input.metadata?.playbookId as string | undefined) ?? undefined,
    clusterCount: (input.metadata?.clusterCount as number | undefined) ?? undefined,
    priorSuccessDecisionIds: priorSuccess,
    ...options.context,
  };

  const rationale = await generateRationale(input, context);
  const decision: Decision = {
    schemaVersion: DECISION_SCHEMA_VERSION,
    decisionId: createDecisionId({ action: input.action, traceId: trigger.traceId, timestamp }),
    timestamp,
    actor: input.actor ?? resolveDecisionActor(),
    action: input.action,
    trigger,
    rationale,
    alternatives: input.alternatives ?? defaultAlternativesForAction(input.action),
    outcome: input.outcome ?? { result: "pending" },
    parentDecisionId: input.parentDecisionId,
    metadata: input.metadata,
  };

  await appendNdjsonRecord(path, decision);
  return decision;
}

export function logDecisionEffect(
  input: DecisionInput,
  options: { projectRoot?: string; context?: RationaleContext } = {}
): Effect.Effect<Decision, never> {
  return Effect.tryPromise({
    try: () => logDecision(input, options),
    catch: () => "log-decision-failed",
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        const timestamp = new Date().toISOString();
        const traceId = input.trigger.traceId || ensureProcessTrace().traceId;
        return {
          schemaVersion: DECISION_SCHEMA_VERSION,
          decisionId: createDecisionId({ action: input.action, traceId, timestamp }),
          timestamp,
          actor: input.actor ?? resolveDecisionActor(),
          action: input.action,
          trigger: { ...input.trigger, traceId },
          rationale: {
            summary: `${input.action} (fallback)`,
            fullReasoning: "Decision logging failed; fallback record returned.",
            evidence: [],
          },
          alternatives: [],
          outcome: { result: "unknown" as const },
        } satisfies Decision;
      })
    )
  );
}

export async function updateDecisionOutcome(
  decisionId: string,
  outcome: DecisionOutcome,
  options: { projectRoot?: string; qualityScore?: number } = {}
): Promise<Decision | null> {
  const projectRoot = options.projectRoot ?? (await resolveDecisionsRoot());
  const path = await resolveDecisionsPath(projectRoot);
  const records = await readDecisions(projectRoot);
  const index = records.findIndex((record) => record.decisionId === decisionId);
  if (index < 0) return null;

  const updated: Decision = {
    ...records[index],
    outcome: {
      ...outcome,
      verifiedAt: outcome.verifiedAt ?? new Date().toISOString(),
    },
    ...(options.qualityScore !== undefined ? { qualityScore: options.qualityScore } : {}),
  };
  records[index] = updated;
  await rewriteNdjsonFile(path, records);
  return updated;
}

export async function updateDecisionQualityScore(
  decisionId: string,
  qualityScore: number,
  projectRoot?: string
): Promise<Decision | null> {
  const root = projectRoot ?? (await resolveDecisionsRoot());
  const path = await resolveDecisionsPath(root);
  const records = await readDecisions(root);
  const index = records.findIndex((record) => record.decisionId === decisionId);
  if (index < 0) return null;
  records[index] = { ...records[index], qualityScore };
  await rewriteNdjsonFile(path, records);
  return records[index];
}

export async function readDecisions(projectRoot?: string): Promise<Decision[]> {
  const root = projectRoot ?? (await resolveDecisionsRoot());
  const path = await resolveDecisionsPath(root);
  const v2 = await readNdjsonFile(path, isDecision);
  if (v2.length > 0) return v2.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const legacy = await readLegacyDecisions();
  return legacy.map(convertLegacyDecision);
}

async function readLegacyDecisions(): Promise<LegacyDecisionRecord[]> {
  const path = decisionLedgerPath();
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParse<LegacyDecisionRecord | null>(line, null))
    .filter((record): record is LegacyDecisionRecord => isLegacyDecision(record));
}

function convertLegacyDecision(record: LegacyDecisionRecord): Decision {
  const action = mapLegacyAction(record.action);
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    decisionId: record.id,
    timestamp: record.timestamp,
    actor: record.metadata?.actor === "user" ? "user" : "kimi",
    action,
    trigger: {
      traceId: record.traceId ?? "legacy-unknown",
    },
    rationale: {
      summary: record.reasoning.slice(0, 120),
      fullReasoning: record.reasoning,
      evidence: record.traceId ? [{ type: "traceStep", traceId: record.traceId }] : [],
    },
    alternatives: record.alternatives.map((alt) => ({
      action: alt,
      feasibility: "medium" as const,
    })),
    outcome: {
      result: mapLegacyOutcome(record.outcome),
      verifiedAt: record.timestamp,
    },
    metadata: { legacy: true, key: record.key, trigger: record.trigger, ...record.metadata },
  };
}

function mapLegacyAction(action: string): DecisionAction {
  if (action.includes("heal")) return "heal";
  if (action.includes("hook")) return "hook-register";
  if (action.includes("contract")) return "contract-sign";
  if (action.includes("config") || action.includes("mcp")) return "config-change";
  if (action.includes("capability")) return "capability-degrade";
  return "heal";
}

function mapLegacyOutcome(outcome: string): DecisionOutcomeResult {
  if (outcome === "success") return "success";
  if (outcome === "skipped") return "skipped";
  if (outcome === "failure") return "failure";
  if (outcome === "pending") return "pending";
  return "unknown";
}

export async function findDecisionById(
  decisionId: string,
  projectRoot?: string
): Promise<Decision | null> {
  const records = await readDecisions(projectRoot);
  return records.find((record) => record.decisionId === decisionId) ?? null;
}

export function buildDecisionGraph(decisions: Decision[], traceId: string): DecisionGraph {
  const related = decisions.filter(
    (decision) =>
      decision.trigger.traceId === traceId ||
      decision.parentDecisionId !== undefined ||
      decision.rationale.evidence.some((item) => item.traceId === traceId)
  );

  const byParent = new Map<string | undefined, Decision[]>();
  for (const decision of related) {
    const parent = decision.parentDecisionId;
    const group = byParent.get(parent) ?? [];
    group.push(decision);
    byParent.set(parent, group);
  }

  const buildNode = (decision: Decision): DecisionGraphNode => ({
    decision,
    children: (byParent.get(decision.decisionId) ?? []).map(buildNode),
  });

  const roots = (byParent.get(undefined) ?? [])
    .filter((decision) => decision.trigger.traceId === traceId || !decision.parentDecisionId)
    .map(buildNode);

  const edges: Array<{ from: string; to: string }> = [];
  for (const decision of related) {
    if (decision.parentDecisionId) {
      edges.push({ from: decision.parentDecisionId, to: decision.decisionId });
    }
  }

  return { traceId, roots, nodes: related, edges };
}

export function renderDecisionGraphAscii(graph: DecisionGraph): string {
  const lines: string[] = [`Decision graph for trace ${graph.traceId}`, ""];

  const walk = (node: DecisionGraphNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const score =
      node.decision.qualityScore !== undefined
        ? ` score=${node.decision.qualityScore.toFixed(2)}`
        : "";
    lines.push(
      `${indent}• ${node.decision.decisionId} [${node.decision.action}] ${node.decision.rationale.summary}${score}`
    );
    for (const child of node.children) walk(child, depth + 1);
  };

  if (graph.roots.length === 0) {
    lines.push("(no decisions linked to this trace)");
  } else {
    for (const root of graph.roots) walk(root, 0);
  }
  return lines.join("\n");
}

export async function suggestDecisions(input: {
  clusterId?: string;
  action?: DecisionAction;
  projectRoot?: string;
  limit?: number;
}): Promise<DecisionSuggestion[]> {
  const root = input.projectRoot ?? (await resolveProjectRoot(Bun.cwd));
  const decisions = await readDecisions(root);
  const filtered = decisions.filter((decision) => {
    if (input.clusterId && decision.trigger.clusterId !== input.clusterId) return false;
    if (input.action && decision.action !== input.action) return false;
    return decision.outcome.result === "success" || (decision.qualityScore ?? 0) >= 0.5;
  });

  const suggestions: DecisionSuggestion[] = filtered.map((decision) => {
    const quality = decision.qualityScore ?? 0.5;
    const confidence = Math.min(
      1,
      quality * 0.7 + (decision.outcome.result === "success" ? 0.3 : 0)
    );
    return {
      decisionId: decision.decisionId,
      action: decision.action,
      confidence: Math.round(confidence * 1000) / 1000,
      qualityScore: quality,
      summary: decision.rationale.summary,
      playbookId: decision.metadata?.playbookId as string | undefined,
      clusterId: decision.trigger.clusterId,
    };
  });

  suggestions.sort((a, b) => b.confidence - a.confidence || b.qualityScore - a.qualityScore);
  return suggestions.slice(0, input.limit ?? 5);
}

export async function buildWhyReport(decisionId: string, projectRoot?: string) {
  const root = projectRoot ?? (await resolveDecisionsRoot());
  const decision = await findDecisionById(decisionId, root);
  if (!decision) return null;

  const [traces, failures, clusters, allDecisions] = await Promise.all([
    readTraceEvents(),
    readFailureTraceRecords(),
    readClusterMetadata(),
    readDecisions(root),
  ]);

  const traceTree = traces.filter(
    (event) =>
      event.traceId === decision.trigger.traceId || event.parentTraceId === decision.trigger.traceId
  );

  const cluster = clusters?.clusters.find((c) => c.clusterId === decision.trigger.clusterId);
  const childDecisions = allDecisions.filter((d) => d.parentDecisionId === decisionId);
  const parentDecision = decision.parentDecisionId
    ? allDecisions.find((d) => d.decisionId === decision.parentDecisionId)
    : undefined;

  return {
    decision,
    traceTree,
    cluster,
    failures: failures.filter(
      (f) => f.traceId === decision.trigger.traceId || f.errorId === decision.trigger.errorId
    ),
    parentDecision,
    childDecisions,
    qualityFactors: {
      qualityScore: decision.qualityScore,
      outcome: decision.outcome,
      alternatives: decision.alternatives,
    },
  };
}

/** @deprecated Use logDecision — kept for one release */
export function recordDecision(input: {
  key: string;
  action: string;
  trigger: string;
  reasoning: string;
  alternatives?: string[];
  outcome: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<Decision> {
  return logDecision({
    action: mapLegacyAction(input.action),
    trigger: { traceId: input.traceId ?? ensureProcessTrace().traceId },
    rationaleOverride: {
      summary: input.reasoning.slice(0, 120),
      fullReasoning: input.reasoning,
    },
    alternatives: (input.alternatives ?? []).map((alt) => ({
      action: alt,
      feasibility: "medium" as const,
    })),
    outcome: { result: mapLegacyOutcome(input.outcome), verifiedAt: new Date().toISOString() },
    metadata: { key: input.key, legacyTrigger: input.trigger, ...input.metadata },
  });
}

export function globalFallbackDecisionsPath(): string {
  return join(homeDir(), ".kimi-code", ".kimi", "decisions.ndjson");
}
