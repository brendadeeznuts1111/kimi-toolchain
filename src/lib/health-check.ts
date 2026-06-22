/**
 * health-check.ts — Shared health check types and aggregation for all kimi-toolchain tools.
 */

export type CheckStatus = "ok" | "warn" | "error";

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
  fixable: boolean;
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
