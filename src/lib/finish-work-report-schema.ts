/**
 * Public on-disk contract for `.kimi/finish-work-report.json` (schema v1.1).
 * Validated without Zod — matches repo minimal-deps policy.
 */

import { join } from "path";
import { LATM_DONE_MARKER } from "./herdr-latm.ts";

export const FINISH_WORK_REPORT_FILENAME = "finish-work-report.json";

export function finishWorkReportPath(projectRoot: string): string {
  return join(projectRoot, ".kimi", FINISH_WORK_REPORT_FILENAME);
}

export const FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION = "1.1";

export type FinishWorkPublicOutcome = "clean" | "dirty" | "escalated" | "aborted" | "partial";

export type FinishWorkGateStatus = "pass" | "fail";

export interface FinishWorkPublicGateEntry {
  status: FinishWorkGateStatus;
  durationMs: number;
  healAuditTriggered?: boolean;
  doctorPane?: string;
}

export interface FinishWorkPublicGit {
  committed: boolean;
  pushed: boolean;
  hash: string | null;
  branch?: string;
  head?: string | null;
  attempted?: boolean;
  error?: string | null;
}

export interface FinishWorkPublicTree {
  clean: boolean;
  dirtyFiles: string[];
  untracked: number;
  /** @deprecated v1.0 alias — prefer dirtyFiles */
  dirty?: string[];
}

export interface FinishWorkPublicReview {
  escalated: boolean;
  reviewerPane: string | null;
  reportPath: string;
  feedback?: string;
  /** ISO timestamp when reviewer feedback was last appended. */
  lastFeedbackAt?: string;
  /** @deprecated alias — prefer lastFeedbackAt */
  feedbackAt?: string;
  resolved?: boolean;
}

export interface FinishWorkPublicLatm {
  markerSeen: boolean;
  completionSignal: string;
  invokedVia: string;
}

export interface FinishWorkPublicHandoffCandidate {
  targetPane: string;
  targetAgent: string;
  reason: string;
  shouldHandoff: boolean;
}

/** Serialized public shape written to `.kimi/finish-work-report.json`. */
export interface FinishWorkReportV11 {
  schemaVersion: typeof FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION;
  timestamp: string;
  agent?: string;
  paneId?: string;
  session?: string;
  durationMs?: number;
  git: FinishWorkPublicGit;
  tree: FinishWorkPublicTree;
  gates: Record<string, FinishWorkPublicGateEntry | FinishWorkGateStatus>;
  outcome: FinishWorkPublicOutcome;
  outcomeReason: string;
  review: FinishWorkPublicReview;
  latm: FinishWorkPublicLatm;
  handoffCandidate: FinishWorkPublicHandoffCandidate | null;
  summary: string;
  /** Internal pipeline state preserved for reviewer tooling. */
  pipelineOutcome?: "ok" | "escalated" | "failed";
  ok?: boolean;
  tool?: string;
  gateSource?: string;
  results?: unknown[];
  followUp?: unknown;
  herdr?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGateStatus(value: unknown): value is FinishWorkGateStatus {
  return value === "pass" || value === "fail";
}

function isPublicOutcome(value: unknown): value is FinishWorkPublicOutcome {
  return (
    value === "clean" ||
    value === "dirty" ||
    value === "escalated" ||
    value === "aborted" ||
    value === "partial"
  );
}

export function isFinishWorkPublicGateEntry(value: unknown): value is FinishWorkPublicGateEntry {
  if (!isRecord(value)) return false;
  if (!isGateStatus(value.status)) return false;
  if (typeof value.durationMs !== "number") return false;
  if (value.healAuditTriggered !== undefined && typeof value.healAuditTriggered !== "boolean") {
    return false;
  }
  if (value.doctorPane !== undefined && typeof value.doctorPane !== "string") return false;
  return true;
}

export function gateStatusFromPublicEntry(
  entry: FinishWorkPublicGateEntry | FinishWorkGateStatus
): FinishWorkGateStatus {
  return typeof entry === "string" ? entry : entry.status;
}

export function validateFinishWorkReportV11(raw: unknown): {
  ok: boolean;
  report?: FinishWorkReportV11;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ["root must be an object"] };
  }

  if (raw.schemaVersion !== FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be "${FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION}"`);
  }
  if (typeof raw.timestamp !== "string" || !raw.timestamp) {
    errors.push("timestamp must be a non-empty ISO string");
  }
  if (!isRecord(raw.git)) {
    errors.push("git must be an object");
  } else {
    if (typeof raw.git.committed !== "boolean") errors.push("git.committed must be boolean");
    if (typeof raw.git.pushed !== "boolean") errors.push("git.pushed must be boolean");
  }
  if (!isRecord(raw.tree)) {
    errors.push("tree must be an object");
  } else {
    if (typeof raw.tree.clean !== "boolean") errors.push("tree.clean must be boolean");
  }
  if (!isPublicOutcome(raw.outcome)) {
    errors.push("outcome must be clean|dirty|escalated|aborted|partial");
  }
  if (typeof raw.outcomeReason !== "string") {
    errors.push("outcomeReason must be a string");
  }
  if (typeof raw.summary !== "string") {
    errors.push("summary must be a string");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, report: raw as unknown as FinishWorkReportV11, errors: [] };
}

export function defaultLatmBlock(invokedVia: string): FinishWorkPublicLatm {
  return {
    markerSeen: true,
    completionSignal: LATM_DONE_MARKER,
    invokedVia,
  };
}
