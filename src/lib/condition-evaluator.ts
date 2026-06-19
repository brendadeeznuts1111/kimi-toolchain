/**
 * Lightweight `when` condition evaluation for orchestrator handoff rules.
 *
 * Supports TOML `when` tables such as:
 *   when = { finishWorkReport.outcome = "clean" }
 *   when = { finishWorkReport.handoffCandidate.shouldHandoff = true }
 *   when = { pane.status = "idle" }
 */

import { pathExists, readText } from "./bun-io.ts";
import { finishWorkReportPath } from "./finish-work-report-schema.ts";
import { gitRevParse } from "./git-helpers.ts";

/** Minimal agent fields required for `pane.*` when evaluation. */
export interface PaneWhenSnapshot {
  paneId: string;
  agent: string;
  status: string;
  workspaceId: string;
  tabId?: string;
  customStatus?: string;
}

export const FINISH_WORK_REPORT_PREFIX = "finishWorkReport.";
export const PANE_PREFIX = "pane.";

/** Supported `pane.*` paths evaluated against the source agent snapshot. */
export const PANE_WHEN_FIELDS = new Set([
  "pane.status",
  "pane.agent",
  "pane.customStatus",
  "pane.paneId",
  "pane.workspaceId",
  "pane.tabId",
]);

export interface ReportConditionClause {
  path: string;
  expected: string | boolean | number;
}

/** @alias ReportConditionClause */
export type WhenConditionClause = ReportConditionClause;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a TOML `when` inline table into condition clauses. */
export function parseWhenTable(raw: unknown): ReportConditionClause[] | null {
  if (!isRecord(raw)) return null;
  const clauses: ReportConditionClause[] = [];
  for (const [path, value] of Object.entries(raw)) {
    const trimmedPath = path.trim();
    if (!trimmedPath) continue;
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      clauses.push({ path: trimmedPath, expected: value });
    }
  }
  return clauses.length > 0 ? clauses : null;
}

/** Read a dot-path from any object (no prefix stripping). */
export function getValueAtPath(root: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function reportSegments(path: string): string[] | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith(FINISH_WORK_REPORT_PREFIX)) return null;
  const rest = trimmed.slice(FINISH_WORK_REPORT_PREFIX.length);
  if (!rest) return null;
  return rest
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function paneSegments(path: string): string[] | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith(PANE_PREFIX)) return null;
  const rest = trimmed.slice(PANE_PREFIX.length);
  if (!rest) return null;
  return rest
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function valuesMatch(actual: unknown, expected: string | boolean | number): boolean {
  if (typeof expected === "boolean") return actual === expected;
  if (typeof expected === "number") return actual === expected;
  return String(actual ?? "") === expected;
}

function loadFinishWorkReportRaw(projectRoot: string): Record<string, unknown> | null {
  const path = finishWorkReportPath(projectRoot);
  if (!pathExists(path)) return null;
  try {
    const parsed = JSON.parse(readText(path)) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readReportHead(report: Record<string, unknown>): string | null {
  const git = isRecord(report.git) ? report.git : null;
  if (typeof git?.head === "string") return git.head;
  if (typeof report.gitHead === "string") return report.gitHead;
  return null;
}

export function paneSnapshotRoot(agent: PaneWhenSnapshot): Record<string, unknown> {
  return {
    status: agent.status,
    agent: agent.agent,
    customStatus: agent.customStatus,
    paneId: agent.paneId,
    workspaceId: agent.workspaceId,
    tabId: agent.tabId,
  };
}

export function partitionWhenClauses(clauses: ReportConditionClause[]): {
  report: ReportConditionClause[];
  pane: ReportConditionClause[];
  unknown: ReportConditionClause[];
} {
  const report: ReportConditionClause[] = [];
  const pane: ReportConditionClause[] = [];
  const unknown: ReportConditionClause[] = [];
  for (const clause of clauses) {
    if (clause.path.startsWith(FINISH_WORK_REPORT_PREFIX)) report.push(clause);
    else if (clause.path.startsWith(PANE_PREFIX)) pane.push(clause);
    else unknown.push(clause);
  }
  return { report, pane, unknown };
}

export function whenIncludesPaneStatus(clauses: ReportConditionClause[] | undefined): boolean {
  return Boolean(clauses?.some((row) => row.path === "pane.status"));
}

/** Evaluate `pane.*` clauses against a resolved source agent snapshot. */
export function evaluatePaneConditions(
  agent: PaneWhenSnapshot,
  clauses: ReportConditionClause[]
): { ok: boolean; message: string } {
  if (clauses.length === 0) {
    return { ok: false, message: "no pane when clauses" };
  }

  const root = paneSnapshotRoot(agent);
  for (const clause of clauses) {
    const segments = paneSegments(clause.path);
    if (!segments) {
      return { ok: false, message: `unsupported when path: ${clause.path}` };
    }
    const actual = getValueAtPath(root, segments.join("."));
    if (!valuesMatch(actual, clause.expected)) {
      return {
        ok: false,
        message: `${clause.path} expected ${JSON.stringify(clause.expected)}, got ${JSON.stringify(actual ?? null)} (${agent.agent}@${agent.paneId})`,
      };
    }
  }

  return { ok: true, message: `pane when satisfied (${clauses.length} clause(s))` };
}

async function evaluateReportClauses(
  projectRoot: string,
  clauses: ReportConditionClause[]
): Promise<{ ok: boolean; message: string }> {
  if (clauses.length === 0) {
    return { ok: false, message: "no report when clauses" };
  }

  const report = loadFinishWorkReportRaw(projectRoot);
  if (!report) {
    return {
      ok: false,
      message: 'no finish-work report — run bun run finish-work --message "..." --push',
    };
  }

  const head = await gitRevParse(projectRoot, "HEAD");
  const storedHead = readReportHead(report);
  const stale = Boolean(storedHead && head && storedHead !== head);
  if (stale) {
    return { ok: false, message: "finish-work report stale (HEAD changed since last close)" };
  }

  for (const clause of clauses) {
    const segments = reportSegments(clause.path);
    if (!segments) {
      return { ok: false, message: `unsupported when path: ${clause.path}` };
    }
    const actual = getValueAtPath(report, segments.join("."));
    if (!valuesMatch(actual, clause.expected)) {
      return {
        ok: false,
        message: `${clause.path} expected ${JSON.stringify(clause.expected)}, got ${JSON.stringify(actual ?? null)}`,
      };
    }
  }

  return { ok: true, message: `report when satisfied (${clauses.length} clause(s))` };
}

/**
 * Evaluate mixed `when` clauses (finishWorkReport.* + pane.*).
 * All clauses must match (AND). Pane clauses require `sourceAgent`.
 */
export async function evaluateWhenConditions(
  projectRoot: string,
  clauses: ReportConditionClause[],
  sourceAgent?: PaneWhenSnapshot
): Promise<{ ok: boolean; message: string }> {
  if (clauses.length === 0) {
    return { ok: false, message: "no when clauses" };
  }

  const { report, pane, unknown } = partitionWhenClauses(clauses);
  if (unknown.length > 0) {
    return { ok: false, message: `unsupported when path: ${unknown[0]!.path}` };
  }

  if (pane.length > 0) {
    if (!sourceAgent) {
      return { ok: false, message: "pane when condition requires source agent" };
    }
    const paneEval = evaluatePaneConditions(sourceAgent, pane);
    if (!paneEval.ok) {
      return { ok: false, message: `pane when not satisfied: ${paneEval.message}` };
    }
  }

  if (report.length > 0) {
    const reportEval = await evaluateReportClauses(projectRoot, report);
    if (!reportEval.ok) {
      return { ok: false, message: `report when not satisfied: ${reportEval.message}` };
    }
  }

  return { ok: true, message: `when satisfied (${clauses.length} clause(s))` };
}

/**
 * Evaluate `when` clauses against `.kimi/finish-work-report.json`.
 * All clauses must match (AND). Paths must start with `finishWorkReport.`.
 */
export async function evaluateFinishWorkReportConditions(
  projectRoot: string,
  clauses: ReportConditionClause[]
): Promise<{ ok: boolean; message: string }> {
  const { report, pane, unknown } = partitionWhenClauses(clauses);
  if (pane.length > 0 || unknown.length > 0) {
    const bad = unknown[0] ?? pane[0];
    return { ok: false, message: `unsupported when path: ${bad!.path}` };
  }
  return evaluateReportClauses(projectRoot, report);
}

export function isReportWhenRule(clauses: ReportConditionClause[] | undefined): boolean {
  return Boolean(clauses?.length);
}

export function whenRuleDedupeKey(clauses: ReportConditionClause[]): string {
  return clauses.map((row) => `${row.path}=${JSON.stringify(row.expected)}`).join("&");
}
