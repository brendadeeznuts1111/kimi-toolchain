/**
 * deep-audit-types.ts — Shared types for the deep-audit pipeline.
 *
 * @see src/bin/kimi-deep-audit.ts for the CLI generator
 * @see src/doctor/deep-audit/report.ts for the report renderer
 */

import type { ImageAuditFinding } from "./image-audit.ts";

export interface DeepAuditRun {
  id: string;
  description: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  summary: string;
  /** Structured findings for audits that emit JSON (e.g., audit:images). */
  findings?: ImageAuditFinding[];
  filesScanned?: number;
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
  /** Rich image-audit results, present when the audit ran and produced findings. */
  imageAudit?: {
    filesScanned: number;
    findings: ImageAuditFinding[];
  };
}
