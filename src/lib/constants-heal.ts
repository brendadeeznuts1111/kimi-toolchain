/**
 * Auto-healing for bunfig [define] constants via golden template diff + repair.
 */

import { listDir, pathExists, removeFile } from "./bun-io.ts";

import { join } from "path";
import {
  loadRepoDefineMap,
  parseBunfigDefines,
  TUNING_SET_VERSION_KEY,
  type DefineEntry,
} from "./build-constants-registry.ts";
import { logDecision, updateDecisionOutcome } from "./decision-ledger.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { constantsGoldenPath, constantsGoldenArchiveDir, failureLedgerPath } from "./paths.ts";
import { ensureDir, sha256String } from "./utils.ts";
import {
  loadConstantSchemas,
  validateConstant,
  type ConstantValidationIssue,
} from "./constants-registry.ts";
import { buildBoundConstantIndex } from "./taxonomy-constants.ts";
import { readFailureTraceRecords } from "./trace-ledger.ts";

export const GOLDEN_SCHEMA_VERSION = "1.0.0";

export interface GoldenConstant {
  defineDomain: string;
  rawValue: string;
  value: string | number | boolean;
}

export interface ConstantsGolden {
  schemaVersion: string;
  tuningSetVersion: string;
  capturedAt: string;
  message?: string;
  constants: Record<string, GoldenConstant>;
}

function normalizeGoldenSchemaVersion(value: unknown): string {
  if (value === 1 || value === "1") return GOLDEN_SCHEMA_VERSION;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return GOLDEN_SCHEMA_VERSION;
}

export function parseConstantsGolden(raw: unknown): ConstantsGolden | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const constants = record.constants;
  if (!constants || typeof constants !== "object") return null;

  const parsedConstants: Record<string, GoldenConstant> = {};
  for (const [key, entry] of Object.entries(constants as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const constant = entry as Record<string, unknown>;
    if (typeof constant.defineDomain !== "string" || typeof constant.rawValue !== "string") {
      continue;
    }
    parsedConstants[key] = {
      defineDomain: constant.defineDomain,
      rawValue: constant.rawValue,
      value: constant.value as string | number | boolean,
    };
  }

  if (Object.keys(parsedConstants).length === 0) return null;

  return {
    schemaVersion: normalizeGoldenSchemaVersion(record.schemaVersion),
    tuningSetVersion:
      typeof record.tuningSetVersion === "string" ? record.tuningSetVersion : "0.0.0",
    capturedAt:
      typeof record.capturedAt === "string" ? record.capturedAt : new Date().toISOString(),
    message: typeof record.message === "string" ? record.message : undefined,
    constants: parsedConstants,
  };
}

export interface InvalidConstant {
  key: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
}

export interface ConstantRepairDiff {
  missingKeys: string[];
  invalidKeys: InvalidConstant[];
}

export interface ConstantRepairPlan {
  goldenPath: string;
  goldenVersion: string;
  diff: ConstantRepairDiff;
  validationIssues: ConstantValidationIssue[];
  goldenValidationIssues: ConstantValidationIssue[];
  repairCount: number;
  canRepair: boolean;
}

export interface ConstantRepairResult {
  applied: boolean;
  dryRun: boolean;
  plan: ConstantRepairPlan;
  decisionId?: string;
  repairedBunfig?: string;
  duplicateDecisionId?: string;
  impact?: ConstantRepairImpact[];
  detail: string;
}

export interface ConstantRepairImpact {
  key: string;
  boundTaxonomies: string[];
  servicesAffected: string[];
  activeFailures: number;
  estimatedRisk: "low" | "medium" | "high";
}

const DEFINE_KEY = /^([A-Z][A-Z0-9_]*) = /;
const MAX_GOLDEN_ARCHIVES = 10;

export interface GoldenArchiveEntry {
  name: string;
  path: string;
  tuningSetVersion: string;
  capturedAt: string;
  schemaVersion: string;
}

function sanitizeArchiveTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function archiveFileName(golden: ConstantsGolden): string {
  return `${golden.tuningSetVersion}-${sanitizeArchiveTimestamp(golden.capturedAt)}.json`;
}

async function archiveCurrentGolden(projectRoot: string): Promise<void> {
  const current = await loadConstantsGolden(projectRoot);
  if (!current) return;

  const archiveDir = constantsGoldenArchiveDir(projectRoot);
  ensureDir(archiveDir);
  const dest = join(archiveDir, archiveFileName(current));
  await Bun.write(dest, `${JSON.stringify(current, null, 2)}\n`);
  pruneGoldenArchives(projectRoot);
}

function pruneGoldenArchives(projectRoot: string): void {
  const archiveDir = constantsGoldenArchiveDir(projectRoot);
  if (!pathExists(archiveDir)) return;

  const entries = listDir(archiveDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(archiveDir, name);
      return { name, path, mtime: Bun.file(path).lastModified };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const entry of entries.slice(MAX_GOLDEN_ARCHIVES)) {
    removeFile(entry.path);
  }
}

export async function listGoldenArchives(projectRoot: string): Promise<GoldenArchiveEntry[]> {
  const archiveDir = constantsGoldenArchiveDir(projectRoot);
  if (!pathExists(archiveDir)) return [];

  const names = listDir(archiveDir).filter((name) => name.endsWith(".json"));
  const entries: GoldenArchiveEntry[] = [];

  for (const name of names) {
    const path = join(archiveDir, name);
    const golden = parseConstantsGolden(await Bun.file(path).json());
    if (!golden) continue;
    entries.push({
      name,
      path,
      tuningSetVersion: golden.tuningSetVersion,
      capturedAt: golden.capturedAt,
      schemaVersion: golden.schemaVersion,
    });
  }

  return entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function restoreGoldenFromArchive(
  projectRoot: string,
  archiveName: string
): Promise<ConstantsGolden> {
  const archiveDir = constantsGoldenArchiveDir(projectRoot);
  const archivePath = join(archiveDir, archiveName);
  if (!pathExists(archivePath)) {
    throw new Error(`Golden archive not found: ${archiveName}`);
  }

  const golden = parseConstantsGolden(await Bun.file(archivePath).json());
  if (!golden) {
    throw new Error(`Invalid golden archive: ${archiveName}`);
  }

  await archiveCurrentGolden(projectRoot);
  const goldenPath = constantsGoldenPath(projectRoot);
  ensureDir(join(projectRoot, ".kimi", "var"));
  await Bun.write(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
  return golden;
}

export async function captureConstantsGolden(
  projectRoot: string,
  options: { message?: string } = {}
): Promise<ConstantsGolden> {
  const defines = parseBunfigDefines(await Bun.file(join(projectRoot, "bunfig.toml")).text());
  const constants: Record<string, GoldenConstant> = {};

  for (const define of defines) {
    constants[define.key] = {
      defineDomain: define.defineDomain,
      rawValue: define.rawValue,
      value: define.value,
    };
  }

  const tuning = constants[TUNING_SET_VERSION_KEY]?.value;
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    tuningSetVersion: typeof tuning === "string" ? tuning : "0.0.0",
    capturedAt: new Date().toISOString(),
    message: options.message,
    constants,
  };
}

export async function writeConstantsGolden(
  projectRoot: string,
  golden?: ConstantsGolden,
  options: { message?: string } = {}
): Promise<ConstantsGolden> {
  await archiveCurrentGolden(projectRoot);
  const snapshot = golden
    ? { ...golden, message: options.message ?? golden.message }
    : await captureConstantsGolden(projectRoot, options);
  const path = constantsGoldenPath(projectRoot);
  ensureDir(join(projectRoot, ".kimi", "var"));
  await Bun.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function loadConstantsGolden(projectRoot: string): Promise<ConstantsGolden | null> {
  const path = constantsGoldenPath(projectRoot);
  if (!pathExists(path)) return null;
  try {
    return parseConstantsGolden(await Bun.file(path).json());
  } catch {
    return null;
  }
}

export function diffAgainstGolden(
  current: Map<string, DefineEntry>,
  golden: ConstantsGolden
): ConstantRepairDiff {
  const missingKeys: string[] = [];
  const invalidKeys: InvalidConstant[] = [];

  for (const [key, goldenEntry] of Object.entries(golden.constants)) {
    const live = current.get(key);
    if (!live) {
      missingKeys.push(key);
      continue;
    }
    if (live.value !== goldenEntry.value) {
      invalidKeys.push({
        key,
        expected: goldenEntry.value,
        actual: live.value,
      });
    }
  }

  missingKeys.sort();
  invalidKeys.sort((a, b) => a.key.localeCompare(b.key));
  return { missingKeys, invalidKeys };
}

export async function buildConstantRepairPlan(projectRoot: string): Promise<ConstantRepairPlan> {
  const goldenPath = constantsGoldenPath(projectRoot);
  const golden = await loadConstantsGolden(projectRoot);
  if (!golden) {
    return {
      goldenPath,
      goldenVersion: "missing",
      diff: { missingKeys: [], invalidKeys: [] },
      validationIssues: [],
      goldenValidationIssues: [],
      repairCount: 0,
      canRepair: false,
    };
  }

  const current = await loadRepoDefineMap(projectRoot);
  const schemas = await loadConstantSchemas(projectRoot);
  const diff = diffAgainstGolden(current, golden);
  const validationIssues: ConstantValidationIssue[] = [];
  const goldenValidationIssues: ConstantValidationIssue[] = [];

  for (const [key, entry] of current) {
    const issue = validateConstant(key, entry.value, schemas.get(key));
    if (issue) validationIssues.push(issue);
  }

  for (const [key, entry] of Object.entries(golden.constants)) {
    const issue = validateConstant(key, entry.value, schemas.get(key));
    if (issue) goldenValidationIssues.push(issue);
  }

  const repairCount = diff.missingKeys.length + diff.invalidKeys.length;

  return {
    goldenPath,
    goldenVersion: golden.tuningSetVersion,
    diff,
    validationIssues,
    goldenValidationIssues,
    repairCount,
    canRepair: repairCount > 0,
  };
}

export function applyDefineRepairs(
  bunfigText: string,
  golden: ConstantsGolden,
  diff: ConstantRepairDiff
): string {
  const lines = bunfigText.split("\n");
  let defineStart = -1;
  let defineEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "[define]") {
      defineStart = i;
      continue;
    }
    if (defineStart >= 0 && line.startsWith("[") && line.endsWith("]")) {
      defineEnd = i;
      break;
    }
  }

  if (defineStart < 0) {
    const goldenLines = Object.entries(golden.constants).flatMap(([key, entry]) => [
      `# define-domain:${entry.defineDomain}`,
      `${key} = ${entry.rawValue}`,
    ]);
    return `${bunfigText.trim()}\n\n[define]\n${goldenLines.join("\n")}\n`;
  }

  for (const invalid of diff.invalidKeys) {
    const goldenEntry = golden.constants[invalid.key];
    if (!goldenEntry) continue;
    for (let i = defineStart + 1; i < defineEnd; i++) {
      const keyMatch = lines[i]!.match(DEFINE_KEY);
      if (keyMatch?.[1] === invalid.key) {
        lines[i] = `${invalid.key} = ${goldenEntry.rawValue}`;
        break;
      }
    }
  }

  const insertLines: string[] = [];
  let lastDomain: string | null = null;
  for (const key of diff.missingKeys) {
    const entry = golden.constants[key];
    if (!entry) continue;
    if (entry.defineDomain !== lastDomain) {
      insertLines.push(`# define-domain:${entry.defineDomain}`);
      lastDomain = entry.defineDomain;
    }
    insertLines.push(`${key} = ${entry.rawValue}`);
  }

  if (insertLines.length > 0) {
    lines.splice(defineEnd, 0, ...insertLines);
  }

  return lines.join("\n");
}

export function repairHashesForDiff(diff: ConstantRepairDiff): string[] {
  const hashes: string[] = [];
  for (const key of diff.missingKeys) {
    hashes.push(sha256String(`${key}:(missing):restore`).slice(0, 16));
  }
  for (const invalid of diff.invalidKeys) {
    hashes.push(
      sha256String(`${invalid.key}:${String(invalid.actual)}:${String(invalid.expected)}`).slice(
        0,
        16
      )
    );
  }
  return hashes.sort();
}

async function findDuplicateRepairDecision(options: {
  projectRoot: string;
  repairHashes: string[];
  nowMs?: number;
  windowMs?: number;
}): Promise<string | undefined> {
  if (options.repairHashes.length === 0) return undefined;
  const { readDecisions } = await import("./decision-ledger.ts");
  const nowMs = options.nowMs ?? Date.now();
  const sinceMs = nowMs - (options.windowMs ?? 60 * 60 * 1000);
  const wanted = options.repairHashes.join(",");

  for (const decision of (await readDecisions(options.projectRoot)).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  )) {
    if (decision.metadata?.type !== "constant-repair") continue;
    const ts = new Date(decision.timestamp).getTime();
    if (ts < sinceMs || ts > nowMs) continue;
    const hashes = decision.metadata?.repairHashes;
    if (!Array.isArray(hashes)) continue;
    const actual = hashes.filter((hash): hash is string => typeof hash === "string").sort();
    if (actual.join(",") === wanted) return decision.decisionId;
  }

  return undefined;
}

function taxonomyIdForFailure(record: { taxonomyId?: string; categoryId?: string }): string {
  return record.taxonomyId || record.categoryId || "unknown";
}

export async function buildConstantRepairImpact(
  projectRoot: string,
  diff: ConstantRepairDiff,
  options: { nowMs?: number; windowMs?: number; failurePath?: string } = {}
): Promise<ConstantRepairImpact[]> {
  const keys = [...diff.missingKeys, ...diff.invalidKeys.map((item) => item.key)].sort();
  if (keys.length === 0) return [];

  const boundIndex = await buildBoundConstantIndex(projectRoot);
  const failures = await readFailureTraceRecords(options.failurePath ?? failureLedgerPath());
  const nowMs = options.nowMs ?? Date.now();
  const sinceMs = nowMs - (options.windowMs ?? 24 * 60 * 60 * 1000);

  return keys.map((key) => {
    const boundTaxonomies = boundIndex.get(key) ?? [];
    const taxonomySet = new Set(boundTaxonomies);
    const active = failures.filter((failure) => {
      const ts = failure.timestamp ? new Date(failure.timestamp).getTime() : 0;
      return ts >= sinceMs && ts <= nowMs && taxonomySet.has(taxonomyIdForFailure(failure));
    });
    const servicesAffected = [
      ...new Set(
        active.map((failure) => failure.toolName).filter((tool): tool is string => !!tool)
      ),
    ].sort();
    const estimatedRisk = active.length === 0 ? "low" : active.length <= 2 ? "medium" : "high";
    return {
      key,
      boundTaxonomies,
      servicesAffected,
      activeFailures: active.length,
      estimatedRisk,
    };
  });
}

export async function acceptConstantsDrift(options: {
  projectRoot: string;
  traceId?: string;
  message?: string;
}): Promise<{ golden: ConstantsGolden; decisionId: string; detail: string }> {
  const traceId = options.traceId ?? ensureProcessTrace().traceId;
  const golden = await writeConstantsGolden(options.projectRoot, undefined, {
    message: options.message,
  });
  const decision = await logDecision(
    {
      action: "config-change",
      trigger: { traceId },
      metadata: {
        type: "constant-drift-accept",
        goldenVersion: golden.tuningSetVersion,
        message: options.message,
        capturedKeys: Object.keys(golden.constants).sort(),
      },
      rationaleOverride: {
        summary: `Accepted current define constants as golden v${golden.tuningSetVersion}`,
        fullReasoning: options.message
          ? `Captured current bunfig.toml [define] values as the new golden template: ${options.message}.`
          : "Captured current bunfig.toml [define] values as the new golden template.",
        evidence: [{ type: "contractDiff", detail: `goldenVersion=${golden.tuningSetVersion}` }],
      },
      outcome: { result: "success", verifiedAt: new Date().toISOString() },
    },
    { projectRoot: options.projectRoot }
  );
  return {
    golden,
    decisionId: decision.decisionId,
    detail: `accepted current [define] constants as golden v${golden.tuningSetVersion}`,
  };
}

export async function repairConstants(options: {
  projectRoot: string;
  dryRun?: boolean;
  traceId?: string;
  includeImpact?: boolean;
}): Promise<ConstantRepairResult> {
  const plan = await buildConstantRepairPlan(options.projectRoot);
  if (plan.goldenValidationIssues.length > 0) {
    const issue = plan.goldenValidationIssues[0]!;
    throw new Error(
      `Invalid golden constant ${issue.key}: ${issue.reason} (value=${String(issue.value)})`
    );
  }
  if (!plan.canRepair) {
    if (plan.goldenVersion === "missing") {
      return {
        applied: false,
        dryRun: !!options.dryRun,
        plan,
        detail: "golden template missing — run: kimi-heal constants snapshot",
      };
    }
    return {
      applied: false,
      dryRun: !!options.dryRun,
      plan,
      detail: "bunfig.toml [define] matches golden template",
    };
  }

  const golden = (await loadConstantsGolden(options.projectRoot))!;
  const bunfigPath = join(options.projectRoot, "bunfig.toml");
  const bunfigText = await Bun.file(bunfigPath).text();
  const repairedBunfig = applyDefineRepairs(bunfigText, golden, plan.diff);
  const restoredKeys = [...plan.diff.missingKeys, ...plan.diff.invalidKeys.map((item) => item.key)];
  const traceId = options.traceId ?? ensureProcessTrace().traceId;
  const repairHashes = repairHashesForDiff(plan.diff);
  const impact = options.includeImpact
    ? await buildConstantRepairImpact(options.projectRoot, plan.diff)
    : undefined;

  if (options.dryRun) {
    return {
      applied: false,
      dryRun: true,
      plan,
      repairedBunfig,
      impact,
      detail: `dry-run: would restore ${restoredKeys.length} key(s): ${restoredKeys.join(", ")}`,
    };
  }

  await Bun.write(bunfigPath, repairedBunfig);
  const duplicateDecisionId = await findDuplicateRepairDecision({
    projectRoot: options.projectRoot,
    repairHashes,
  });
  if (duplicateDecisionId) {
    return {
      applied: true,
      dryRun: false,
      plan,
      duplicateDecisionId,
      repairedBunfig,
      impact,
      detail: `restored ${restoredKeys.length} key(s); duplicate decision suppressed (${duplicateDecisionId})`,
    };
  }

  const decision = await logDecision(
    {
      action: "config-change",
      trigger: { traceId },
      metadata: {
        type: "constant-repair",
        playbookId: "constant-repair",
        goldenVersion: golden.tuningSetVersion,
        restoredKeys,
        repairHashes,
        diff: plan.diff,
      },
      rationaleOverride: {
        summary: `Restored ${restoredKeys.length} define constant(s) from golden v${golden.tuningSetVersion}`,
        fullReasoning: `Compared bunfig.toml [define] against ${plan.goldenPath} and restored missing or drifted keys: ${restoredKeys.join(", ")}.`,
        evidence: [
          {
            type: "contractDiff",
            detail: `goldenVersion=${golden.tuningSetVersion}; restored=${restoredKeys.join(",")}`,
          },
        ],
      },
      outcome: { result: "success", verifiedAt: new Date().toISOString() },
    },
    { projectRoot: options.projectRoot }
  );

  await updateDecisionOutcome(
    decision.decisionId,
    {
      result: "success",
      verifiedAt: new Date().toISOString(),
      proof: {
        type: "drift-resolved",
        detail: "bunfig.toml [define] realigned to golden template",
      },
    },
    { projectRoot: options.projectRoot }
  );

  return {
    applied: true,
    dryRun: false,
    plan,
    decisionId: decision.decisionId,
    repairedBunfig,
    impact,
    detail: `restored ${restoredKeys.length} key(s); decision ${decision.decisionId}`,
  };
}
