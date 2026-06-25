/**
 * health-check.ts — Shared health check types and aggregation for all kimi-toolchain tools.
 */

import type { ToolInvocation } from "./tool-runner.ts";

export type CheckStatus = "ok" | "warn" | "error";

export interface AdapterOutput {
  adapterName: string;
  durationMs: number;
  checks: HealthCheck[];
  rawOutput?: string;
}

export interface ExternalToolAdapter {
  name: string;
  command: string[];
  env?: Record<string, string | undefined>;
  parse(result: ToolInvocation): AdapterOutput;
}

export interface WorkspaceKnownContext {
  clusterId: string;
  decisionIds: string[];
  seenCount: number;
  lastSeenAt: string;
  summary: string;
}

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fixable?: boolean;
  /** Links to error-taxonomy.yml category id */
  category?: string;
  /** Shell command hint for automated recovery */
  autoFix?: string;
  /** Known-blocker context from the decision ledger. */
  known?: WorkspaceKnownContext;
  /** Navigable source for --open / Bun.openInEditor. */
  source?: CheckSource;
}

/** File location attached to a health check for editor navigation. */
export interface CheckSource {
  file: string;
  line?: number;
  column?: number;
}

export interface HealthReport {
  tool: string;
  checks: HealthCheck[];
  fixableCount: number;
  errorCount: number;
  warnCount: number;
}

/** Backward-compatible alias used by scaffold-doctor and utils consumers. */
export type DoctorCheck = HealthCheck;

/** Backward-compatible alias. */
export type DoctorReport = HealthReport;

export function statusIcon(status: CheckStatus): string {
  return status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
}

/** Pure reducer: aggregate checks into a report with derived counts. */
export function aggregateChecks(tool: string, checks: HealthCheck[]): HealthReport {
  return {
    tool,
    checks,
    errorCount: checks.filter((c) => c.status === "error").length,
    warnCount: checks.filter((c) => c.status === "warn").length,
    fixableCount: checks.filter((c) => c.fixable).length,
  };
}

/** @deprecated Use aggregateChecks */
export function buildDoctorReport(tool: string, checks: HealthCheck[]): HealthReport {
  return aggregateChecks(tool, checks);
}

const SOURCE_RE = /(?:^|\s|at\s)([^\s:()]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/;

/** Extract a navigable source location from a check message. */
export function parseCheckSource(message: string): CheckSource | undefined {
  const match = message.match(SOURCE_RE);
  if (!match?.[1]) return undefined;
  return {
    file: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
  };
}

/** Open the first warn/error check in the user's editor. Returns true when opened. */
export function openFirstFailedCheck(checks: HealthCheck[], cwd = process.cwd()): boolean {
  const failed = checks.find((c) => c.status === "error" || c.status === "warn");
  if (!failed) return false;
  const source = failed.source ?? parseCheckSource(failed.message);
  if (!source) return false;
  const file = source.file.startsWith("/")
    ? source.file
    : Bun.fileURLToPath(new URL(source.file, Bun.pathToFileURL(`${cwd}/`)));
  Bun.openInEditor(file, { line: source.line, column: source.column });
  return true;
}

/** Open first hardcoded-secrets gate finding when present. */
export function openFirstGateFinding(
  gate: string,
  detail: { findings?: Array<{ file: string; line: number }> } | undefined,
  cwd = process.cwd()
): boolean {
  if (gate !== "hardcoded-secrets") return false;
  const first = detail?.findings?.[0];
  if (!first) return false;
  const file = first.file.startsWith("/")
    ? first.file
    : Bun.fileURLToPath(new URL(first.file, Bun.pathToFileURL(`${cwd}/`)));
  Bun.openInEditor(file, { line: first.line });
  return true;
}
