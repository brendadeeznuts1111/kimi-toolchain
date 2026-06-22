/**
 * deep-audit-types.ts — Shared types for the deep-audit pipeline.
 *
 * @see src/bin/kimi-deep-audit.ts for the CLI generator
 * @see src/doctor/deep-audit/report.ts for the report renderer
 */

export interface DeepAuditRun {
  id: string;
  description: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  summary: string;
}

export interface DeepAuditReport {
  schemaVersion: 1;
  generatedAt: string;
  projectRoot: string;
  bunVersion: string;
  full: boolean;
  runs: DeepAuditRun[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
  };
}
