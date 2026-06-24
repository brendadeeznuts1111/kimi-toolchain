/**
 * workflow/types.ts — Scanner workflow loop types and effect options.
 */

export type ScannerStatus = "ok" | "warn" | "error";
export type IssueSeverity = "low" | "medium" | "high" | "critical";

export interface ScannerIssue {
  severity: IssueSeverity;
  message: string;
  package?: string;
  currentVersion?: string;
}

export interface ScannerResult {
  scannerId: string;
  status: ScannerStatus;
  issues: ScannerIssue[];
  data?: Record<string, unknown>;
}

export interface WorkflowDomain {
  id: string;
  projectRoot: string;
}

export type DriftMap = Record<string, unknown>;

export interface WorkflowEffects {
  /** Emit extra drift detail to stderr (default true). */
  log?: boolean;
  /** Webhook URL for alert payloads. */
  alert?: string;
  /** Attempt automatic semver remediation via bun add. */
  fix?: boolean;
  /** true → reports/<domain>-workflow.md; string → custom path. */
  report?: boolean | string;
  /** When true, effects run without blocking the caller (watch loops). */
  nonBlocking?: boolean;
}

export interface WorkflowOptions {
  scanners?: string[];
  intervalMs?: number;
  output?: "table" | "json" | "herdr";
  seedPath?: string;
  seedWritePath?: string;
  failOnIssue?: boolean;
  failOnDrift?: boolean;
  failOnSeverity?: IssueSeverity;
  dryRun?: boolean;
  watch?: boolean;
  effects?: WorkflowEffects;
}

export interface WorkflowSeedState {
  domainId: string;
  generatedAt: string;
  results: ScannerResult[];
}

export interface WorkflowRunSummary {
  domainId: string;
  timestamp: string;
  results: ScannerResult[];
  drift: DriftMap | null;
  failed: boolean;
}

export type ScannerFn = (ctx: {
  domain: WorkflowDomain;
  projectRoot: string;
}) => Promise<ScannerResult>;
