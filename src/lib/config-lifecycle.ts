/**
 * Config lifecycle for build-time `[define]` constants.
 *
 * Canary and A/B workflows are local validation proposals only. Build-time
 * Bun constants cannot route live traffic, so real mutations stay behind --yes.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { Effect } from "effect";
import {
  diffAgainstGolden,
  loadConstantsGolden,
  type ConstantRepairDiff,
} from "./constants-heal.ts";
import {
  loadRepoDefineMap,
  parseBuildConstantsTypes,
  parseDefineRawValue,
  type DefineEntry,
  type TypeEntry,
} from "./build-constants-registry.ts";
import { readDecisions, type Decision, logDecision } from "./decision-ledger.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { ConstantsRegistry, TestConstants, type ConstantValue } from "./constants-registry.ts";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import { configLifecyclePath, healthSnapshotsPath } from "./paths.ts";
import { ensureDir, safeParse, sha256String } from "./utils.ts";

export const CONFIG_LIFECYCLE_SCHEMA_VERSION = 1;

export type ConfigLifecycleType = "canary" | "ab" | "apply" | "rollback" | "watch";
export type ConfigLifecycleStatus = "proposed" | "passed" | "failed" | "applied" | "rolled-back";
export type ConfigValidationSeverity = "warn" | "error";

export interface ConstantValidationIssue {
  key: string;
  severity: ConfigValidationSeverity;
  message: string;
}

export interface ConfigLifecycleRecord {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  id: string;
  timestamp: string;
  type: ConfigLifecycleType;
  constant: string;
  values: Record<string, ConstantValue>;
  status: ConfigLifecycleStatus;
  validationIssues: ConstantValidationIssue[];
  suite?: string;
  decisionId?: string;
  healthBefore?: { timestamp: string; score: number };
  healthAfter?: { timestamp: string; score: number };
  message?: string;
}

export interface ConfigValidateReport {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  constants: Array<{
    key: string;
    value: ConstantValue;
    type: string;
    defineDomain: string;
    line: number;
  }>;
  issues: ConstantValidationIssue[];
  summary: { errors: number; warnings: number; ok: boolean };
}

export interface ConfigDiffReport {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  goldenVersion: string;
  diff: ConstantRepairDiff;
  validationIssues: ConstantValidationIssue[];
  suggestedNextCommand: string;
}

export interface TimelineEvent {
  timestamp: string;
  source: "decision" | "lifecycle";
  id: string;
  type: string;
  status?: string;
  summary: string;
}

export interface TimelineReport {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  constant: string;
  events: TimelineEvent[];
}

export interface ProposalResult {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  record: ConfigLifecycleRecord;
  variants: Array<{
    name: string;
    value: ConstantValue;
    passed: boolean;
    issues: ConstantValidationIssue[];
  }>;
  recommendation: string;
}

export interface WatchReport {
  schemaVersion: typeof CONFIG_LIFECYCLE_SCHEMA_VERSION;
  proposalId?: string;
  status: "insufficient-data" | "healthy" | "rollback-recommended" | "rolled-back";
  threshold: number;
  scoreDrop?: number;
  healthBefore?: { timestamp: string; score: number };
  healthAfter?: { timestamp: string; score: number };
  rollbackCommand?: string;
  record?: ConfigLifecycleRecord;
}

interface HealthSnapshot {
  timestamp: string;
  score: number;
}

function lifecycleId(input: {
  type: ConfigLifecycleType;
  constant: string;
  values: Record<string, ConstantValue>;
  suite?: string;
}): string {
  return `cfg-${sha256String(JSON.stringify(input)).slice(0, 16)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function issue(
  key: string,
  severity: ConfigValidationSeverity,
  message: string
): ConstantValidationIssue {
  return { key, severity, message };
}

export async function loadBuildConstantTypes(projectRoot: string): Promise<Map<string, TypeEntry>> {
  const path = join(projectRoot, "types", "build-constants.d.ts");
  if (!pathExists(path)) return new Map();
  return parseBuildConstantsTypes(await Bun.file(path).text());
}

function validateValueAgainstType(
  key: string,
  value: ConstantValue,
  schema: TypeEntry
): ConstantValidationIssue[] {
  const issues: ConstantValidationIssue[] = [];
  if (schema.type === "number" && typeof value !== "number") {
    issues.push(issue(key, "error", `expected number, got ${typeof value}`));
    return issues;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    issues.push(issue(key, "error", `expected boolean, got ${typeof value}`));
    return issues;
  }
  if (schema.type === "string" && typeof value !== "string") {
    issues.push(issue(key, "error", `expected string, got ${typeof value}`));
    return issues;
  }

  const restrictions = schema.restrictions ?? "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(issue(key, "error", "number must be finite"));
    if (/positive integer/i.test(restrictions) && (!Number.isInteger(value) || value <= 0)) {
      issues.push(issue(key, "error", "must be a positive integer"));
    }
    if (/\[0,\s*1\]/.test(restrictions) && (value < 0 || value > 1)) {
      issues.push(issue(key, "error", "must be between 0 and 1"));
    }
  }
  if (typeof value === "string") {
    if (/semver/i.test(restrictions) && !/^\d+\.\d+\.\d+/.test(value)) {
      issues.push(issue(key, "error", "must be a semver string"));
    }
    if (/relative path/i.test(restrictions) && value.startsWith("/")) {
      issues.push(issue(key, "error", "must be a relative path"));
    }
  }

  return issues;
}

function validateCrossConstantRules(defines: Map<string, DefineEntry>): ConstantValidationIssue[] {
  const issues: ConstantValidationIssue[] = [];
  const retries = [...defines.values()].filter((entry) => entry.key.endsWith("_MAX_RETRIES"));
  for (const retry of retries) {
    if (typeof retry.value !== "number") continue;
    const prefix = retry.key.slice(0, -"_MAX_RETRIES".length);
    const timeout = defines.get(`${prefix}_TIMEOUT_MS`);
    const delay = defines.get(`${prefix}_RETRY_DELAY_MS`);
    if (
      timeout &&
      delay &&
      typeof timeout.value === "number" &&
      typeof delay.value === "number" &&
      timeout.value > delay.value * retry.value
    ) {
      issues.push(
        issue(
          timeout.key,
          "warn",
          `timeout ${timeout.value} exceeds retry delay budget ${delay.value * retry.value}`
        )
      );
    }
  }
  return issues;
}

export async function validateConfigConstants(projectRoot: string): Promise<ConfigValidateReport> {
  const [defines, types] = await Promise.all([
    loadRepoDefineMap(projectRoot),
    loadBuildConstantTypes(projectRoot),
  ]);
  const issues: ConstantValidationIssue[] = [];

  for (const define of defines.values()) {
    const schema = types.get(define.key);
    if (!schema) {
      issues.push(issue(define.key, "warn", "unknown define constant"));
      continue;
    }
    issues.push(...validateValueAgainstType(define.key, define.value, schema));
  }

  for (const key of types.keys()) {
    if (!defines.has(key))
      issues.push(issue(key, "error", "declared constant missing from bunfig"));
  }

  issues.push(...validateCrossConstantRules(defines));
  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.filter((item) => item.severity === "warn").length;

  return {
    schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
    constants: [...defines.values()].map((entry) => ({
      key: entry.key,
      value: entry.value,
      type: types.get(entry.key)?.type ?? typeof entry.value,
      defineDomain: entry.defineDomain,
      line: entry.line,
    })),
    issues,
    summary: { errors, warnings, ok: errors === 0 },
  };
}

export async function validateProposedValue(
  projectRoot: string,
  key: string,
  value: ConstantValue
): Promise<ConstantValidationIssue[]> {
  const types = await loadBuildConstantTypes(projectRoot);
  const schema = types.get(key);
  if (!schema) return [issue(key, "error", "unknown define constant")];
  return validateValueAgainstType(key, value, schema);
}

export async function buildConfigDiffReport(projectRoot: string): Promise<ConfigDiffReport> {
  const golden = await loadConstantsGolden(projectRoot);
  const current = await loadRepoDefineMap(projectRoot);
  const validation = await validateConfigConstants(projectRoot);
  const diff = golden ? diffAgainstGolden(current, golden) : { missingKeys: [], invalidKeys: [] };
  return {
    schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
    goldenVersion: golden?.tuningSetVersion ?? "missing",
    diff,
    validationIssues: validation.issues,
    suggestedNextCommand:
      diff.missingKeys.length + diff.invalidKeys.length > 0
        ? "kimi-heal repair-constants --dry-run --impact"
        : "kimi-config validate",
  };
}

export async function readConfigLifecycle(projectRoot: string): Promise<ConfigLifecycleRecord[]> {
  return readNdjsonFile<ConfigLifecycleRecord>(configLifecyclePath(projectRoot));
}

async function appendConfigLifecycle(
  projectRoot: string,
  record: ConfigLifecycleRecord
): Promise<ConfigLifecycleRecord> {
  await appendNdjsonRecord(configLifecyclePath(projectRoot), record);
  return record;
}

function decisionLifecycleType(decision: Decision): string | undefined {
  const type = decision.metadata?.type;
  return typeof type === "string" ? type : undefined;
}

function decisionTouchesConstant(decision: Decision, key: string): boolean {
  if (decision.metadata?.constantKey === key) return true;
  const restored = decision.metadata?.restoredKeys;
  return Array.isArray(restored) && restored.includes(key);
}

export async function buildConfigTimeline(
  projectRoot: string,
  constant: string
): Promise<TimelineReport> {
  const [records, decisions] = await Promise.all([
    readConfigLifecycle(projectRoot),
    readDecisions(projectRoot),
  ]);
  const events: TimelineEvent[] = [];

  for (const record of records) {
    if (record.constant !== constant) continue;
    events.push({
      timestamp: record.timestamp,
      source: "lifecycle",
      id: record.id,
      type: record.type,
      status: record.status,
      summary: record.message ?? `${record.type} ${record.status}`,
    });
  }

  for (const decision of decisions) {
    if (!decisionTouchesConstant(decision, constant)) continue;
    events.push({
      timestamp: decision.timestamp,
      source: "decision",
      id: decision.decisionId,
      type: decisionLifecycleType(decision) ?? decision.action,
      status: decision.outcome.result,
      summary: decision.rationale.summary,
    });
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION, constant, events };
}

function parseCliConstantValue(raw: string, schema?: TypeEntry): ConstantValue {
  if (!schema) return parseDefineRawValue(raw);
  if (schema.type === "number") return Number(raw);
  if (schema.type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }
  return raw;
}

export async function parseProposedConstantValue(
  projectRoot: string,
  key: string,
  raw: string
): Promise<ConstantValue> {
  const types = await loadBuildConstantTypes(projectRoot);
  return parseCliConstantValue(raw, types.get(key));
}

function runSuiteWithOverridesEffect(
  projectRoot: string,
  overrides: Record<string, ConstantValue>
): Effect.Effect<Record<string, ConstantValue>, never> {
  return Effect.gen(function* () {
    const registry = yield* ConstantsRegistry;
    return yield* registry.getAll();
  }).pipe(Effect.provide(TestConstants(projectRoot, overrides)));
}

export function createCanaryProposalEffect(input: {
  projectRoot: string;
  constant: string;
  value: ConstantValue;
  percent: number;
  suite?: string;
  message?: string;
}): Effect.Effect<ProposalResult, Error> {
  return Effect.gen(function* () {
    const current = yield* Effect.tryPromise({
      try: () => loadRepoDefineMap(input.projectRoot),
      catch: (err) =>
        new Error(
          `Failed to load repo defines: ${err instanceof Error ? err.message : Bun.inspect(err)}`
        ),
    });
    const issues = yield* Effect.tryPromise({
      try: () => validateProposedValue(input.projectRoot, input.constant, input.value),
      catch: (err) => new Error(Bun.inspect(err)),
    });
    const allValues = yield* runSuiteWithOverridesEffect(input.projectRoot, {
      [input.constant]: input.value,
    });
    if (allValues[input.constant] !== input.value) {
      issues.push(issue(input.constant, "error", "test constant override did not resolve"));
    }
    const passed = issues.every((item) => item.severity !== "error");
    const values = {
      current: current.get(input.constant)?.value ?? "(missing)",
      candidate: input.value,
      percent: input.percent,
    };
    const record: ConfigLifecycleRecord = {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      id: lifecycleId({ type: "canary", constant: input.constant, values, suite: input.suite }),
      timestamp: nowIso(),
      type: "canary",
      constant: input.constant,
      values,
      status: passed ? "passed" : "failed",
      validationIssues: issues,
      suite: input.suite ?? "default",
      message:
        input.message ??
        `proposal-only canary intent: ${input.constant}=${String(input.value)} at ${input.percent}%`,
    };
    yield* Effect.tryPromise({
      try: () => appendConfigLifecycle(input.projectRoot, record),
      catch: (err) =>
        new Error(
          `Failed to append canary proposal: ${err instanceof Error ? err.message : Bun.inspect(err)}`
        ),
    });
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      record,
      variants: [{ name: "candidate", value: input.value, passed, issues }],
      recommendation: passed
        ? `apply with: kimi-config apply ${record.id} --yes`
        : "fix validation issues",
    };
  });
}

export function createAbProposalEffect(input: {
  projectRoot: string;
  constant: string;
  a: ConstantValue;
  b: ConstantValue;
  duration: string;
  suite?: string;
}): Effect.Effect<ProposalResult, Error> {
  return Effect.gen(function* () {
    const [issuesA, issuesB] = yield* Effect.all(
      [
        Effect.tryPromise({
          try: () => validateProposedValue(input.projectRoot, input.constant, input.a),
          catch: (err) => new Error(Bun.inspect(err)),
        }),
        Effect.tryPromise({
          try: () => validateProposedValue(input.projectRoot, input.constant, input.b),
          catch: (err) => new Error(Bun.inspect(err)),
        }),
      ],
      { concurrency: 2 }
    );
    yield* runSuiteWithOverridesEffect(input.projectRoot, { [input.constant]: input.a });
    yield* runSuiteWithOverridesEffect(input.projectRoot, { [input.constant]: input.b });
    const aPassed = issuesA.every((item) => item.severity !== "error");
    const bPassed = issuesB.every((item) => item.severity !== "error");
    const values = { a: input.a, b: input.b, duration: input.duration };
    const record: ConfigLifecycleRecord = {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      id: lifecycleId({ type: "ab", constant: input.constant, values, suite: input.suite }),
      timestamp: nowIso(),
      type: "ab",
      constant: input.constant,
      values,
      status: aPassed && bPassed ? "passed" : "failed",
      validationIssues: [...issuesA, ...issuesB],
      suite: input.suite ?? "default",
      message: `proposal-only A/B intent: ${input.constant} A=${String(input.a)} B=${String(input.b)} for ${input.duration}`,
    };
    yield* Effect.tryPromise({
      try: () => appendConfigLifecycle(input.projectRoot, record),
      catch: (err) =>
        new Error(
          `Failed to append A/B proposal: ${err instanceof Error ? err.message : Bun.inspect(err)}`
        ),
    });
    const recommendation =
      bPassed && !aPassed ? "prefer b" : aPassed && !bPassed ? "prefer a" : "compare externally";
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      record,
      variants: [
        { name: "a", value: input.a, passed: aPassed, issues: issuesA },
        { name: "b", value: input.b, passed: bPassed, issues: issuesB },
      ],
      recommendation,
    };
  });
}

function rawValueForBunfig(value: ConstantValue, schema?: TypeEntry): string {
  if (schema?.type === "string" || typeof value === "string") {
    return `'"${String(value).replace(/"/g, '\\"')}"'`;
  }
  return `"${String(value)}"`;
}

function rewriteDefineValue(
  bunfigText: string,
  key: string,
  value: ConstantValue,
  schema?: TypeEntry
): string {
  const lines = bunfigText.split("\n");
  const rawValue = rawValueForBunfig(value, schema);
  let inDefine = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "[define]") {
      inDefine = true;
      continue;
    }
    if (inDefine && line.startsWith("[") && line.endsWith("]")) break;
    if (!inDefine) continue;
    if (line.startsWith(`${key} = `)) {
      lines[i] = `${key} = ${rawValue}`;
      return lines.join("\n");
    }
  }
  throw new Error(`Define key not found in bunfig.toml: ${key}`);
}

async function isBunfigDirty(projectRoot: string): Promise<boolean> {
  if (!pathExists(join(projectRoot, ".git"))) return false;
  const unstaged = Bun.spawn(["git", "diff", "--quiet", "--", "bunfig.toml"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  const staged = Bun.spawn(["git", "diff", "--cached", "--quiet", "--", "bunfig.toml"], {
    cwd: projectRoot,
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await unstaged.exited) !== 0 || (await staged.exited) !== 0;
}

export async function applyLifecycleProposal(input: {
  projectRoot: string;
  proposalId: string;
  message?: string;
  traceId?: string;
  allowDirtyBunfig?: boolean;
}): Promise<ConfigLifecycleRecord> {
  const records = await readConfigLifecycle(input.projectRoot);
  const proposal = records.find((record) => record.id === input.proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${input.proposalId}`);
  if (proposal.status !== "passed") throw new Error(`Proposal is not passed: ${proposal.status}`);
  if (proposal.type !== "canary") throw new Error("Only canary proposals can be applied directly");

  const candidate = proposal.values.candidate;
  if (candidate === undefined) throw new Error("Proposal missing candidate value");
  const issues = await validateProposedValue(input.projectRoot, proposal.constant, candidate);
  if (issues.some((item) => item.severity === "error")) {
    throw new Error(`Invalid proposal value for ${proposal.constant}`);
  }
  if (!input.allowDirtyBunfig && (await isBunfigDirty(input.projectRoot))) {
    throw new Error("bunfig.toml has uncommitted changes; pass --allow-dirty-bunfig to override");
  }

  const current = await loadRepoDefineMap(input.projectRoot);
  const previous = current.get(proposal.constant)?.value;
  const types = await loadBuildConstantTypes(input.projectRoot);
  const bunfigPath = join(input.projectRoot, "bunfig.toml");
  const rewritten = rewriteDefineValue(
    await Bun.file(bunfigPath).text(),
    proposal.constant,
    candidate,
    types.get(proposal.constant)
  );
  await Bun.write(bunfigPath, rewritten);

  const traceId = input.traceId ?? ensureProcessTrace().traceId;
  const decision = await logDecision(
    {
      action: "config-change",
      trigger: { traceId, capabilityItem: proposal.constant },
      metadata: {
        type: "constant-lifecycle-apply",
        constantKey: proposal.constant,
        proposalId: proposal.id,
        previous,
        applied: candidate,
      },
      rationaleOverride: {
        summary: `Applied ${proposal.constant} lifecycle proposal ${proposal.id}`,
        fullReasoning: `Applied proposal ${proposal.id} by rewriting bunfig.toml [define] ${proposal.constant} from ${String(previous)} to ${String(candidate)}.`,
      },
      outcome: { result: "success", verifiedAt: nowIso() },
    },
    { projectRoot: input.projectRoot }
  );

  return appendConfigLifecycle(input.projectRoot, {
    schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
    id: lifecycleId({
      type: "apply",
      constant: proposal.constant,
      values: { previous: previous ?? "(missing)", applied: candidate },
      suite: proposal.suite,
    }),
    timestamp: nowIso(),
    type: "apply",
    constant: proposal.constant,
    values: { previous: previous ?? "(missing)", applied: candidate, proposalId: proposal.id },
    status: "applied",
    validationIssues: issues,
    suite: proposal.suite,
    decisionId: decision.decisionId,
    message: input.message ?? `applied proposal ${proposal.id}`,
  });
}

export async function rollbackLifecycleChange(input: {
  projectRoot: string;
  id: string;
  traceId?: string;
  allowDirtyBunfig?: boolean;
}): Promise<ConfigLifecycleRecord> {
  const records = await readConfigLifecycle(input.projectRoot);
  const target = records.find((record) => record.id === input.id || record.decisionId === input.id);
  if (!target) throw new Error(`Lifecycle record not found: ${input.id}`);
  const previous = target.values.previous;
  if (previous === undefined) throw new Error(`Record ${input.id} has no previous value`);
  if (!input.allowDirtyBunfig && (await isBunfigDirty(input.projectRoot))) {
    throw new Error("bunfig.toml has uncommitted changes; pass --allow-dirty-bunfig to override");
  }

  const types = await loadBuildConstantTypes(input.projectRoot);
  const bunfigPath = join(input.projectRoot, "bunfig.toml");
  const rewritten = rewriteDefineValue(
    await Bun.file(bunfigPath).text(),
    target.constant,
    previous,
    types.get(target.constant)
  );
  await Bun.write(bunfigPath, rewritten);

  const traceId = input.traceId ?? ensureProcessTrace().traceId;
  const decision = await logDecision(
    {
      action: "config-change",
      trigger: { traceId, capabilityItem: target.constant },
      metadata: {
        type: "constant-lifecycle-rollback",
        constantKey: target.constant,
        targetId: target.id,
        restored: previous,
      },
      rationaleOverride: {
        summary: `Rolled back ${target.constant} lifecycle change ${target.id}`,
        fullReasoning: `Restored bunfig.toml [define] ${target.constant} to ${String(previous)} from lifecycle record ${target.id}.`,
      },
      outcome: { result: "success", verifiedAt: nowIso() },
    },
    { projectRoot: input.projectRoot }
  );

  return appendConfigLifecycle(input.projectRoot, {
    schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
    id: lifecycleId({
      type: "rollback",
      constant: target.constant,
      values: { restored: previous, targetId: target.id },
    }),
    timestamp: nowIso(),
    type: "rollback",
    constant: target.constant,
    values: { restored: previous, targetId: target.id },
    status: "rolled-back",
    validationIssues: [],
    decisionId: decision.decisionId,
    message: `rolled back ${target.id}`,
  });
}

function isHealthSnapshot(value: unknown): value is HealthSnapshot {
  const record = value as Record<string, unknown>;
  return (
    !!record &&
    typeof record.timestamp === "string" &&
    typeof record.score === "number" &&
    Number.isFinite(record.score)
  );
}

export async function readHealthSnapshots(projectRoot: string): Promise<HealthSnapshot[]> {
  const path = healthSnapshotsPath(projectRoot);
  if (!pathExists(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParse<unknown | null>(line, null))
    .filter(isHealthSnapshot)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function watchLifecycleProposal(input: {
  projectRoot: string;
  proposalId?: string;
  threshold: number;
  dryRun?: boolean;
  applyRollback?: boolean;
}): Promise<WatchReport> {
  const records = await readConfigLifecycle(input.projectRoot);
  const proposal = input.proposalId
    ? records.find(
        (record) =>
          record.type === "apply" &&
          (record.id === input.proposalId ||
            record.decisionId === input.proposalId ||
            record.values.proposalId === input.proposalId)
      )
    : records.findLast((record) => record.type === "apply");
  const health = await readHealthSnapshots(input.projectRoot);
  if (!proposal || health.length < 2) {
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      proposalId: input.proposalId,
      status: "insufficient-data",
      threshold: input.threshold,
    };
  }

  const before = [...health].reverse().find((item) => item.timestamp <= proposal.timestamp);
  const after = health.find((item) => item.timestamp > proposal.timestamp) ?? health.at(-1);
  if (!before || !after) {
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      proposalId: proposal.id,
      status: "insufficient-data",
      threshold: input.threshold,
    };
  }

  const scoreDrop = before.score - after.score;
  if (scoreDrop <= input.threshold) {
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      proposalId: proposal.id,
      status: "healthy",
      threshold: input.threshold,
      scoreDrop,
      healthBefore: before,
      healthAfter: after,
    };
  }

  if (input.applyRollback && !input.dryRun) {
    const record = await rollbackLifecycleChange({
      projectRoot: input.projectRoot,
      id: proposal.id,
    });
    return {
      schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
      proposalId: proposal.id,
      status: "rolled-back",
      threshold: input.threshold,
      scoreDrop,
      healthBefore: before,
      healthAfter: after,
      record,
    };
  }

  return {
    schemaVersion: CONFIG_LIFECYCLE_SCHEMA_VERSION,
    proposalId: proposal.id,
    status: "rollback-recommended",
    threshold: input.threshold,
    scoreDrop,
    healthBefore: before,
    healthAfter: after,
    rollbackCommand: `kimi-config rollback ${proposal.id} --yes`,
  };
}

export function ensureConfigLifecycleDir(projectRoot: string): void {
  ensureDir(join(projectRoot, ".kimi", "var"));
}
