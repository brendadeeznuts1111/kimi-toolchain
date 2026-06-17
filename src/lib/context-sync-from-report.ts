/**
 * Build context-sync / handoff briefs from `.kimi/finish-work-report.json` (v1.1).
 */

import { pathExists, readText } from "./bun-io.ts";
import { finishWorkReportPath } from "./finish-work-herdr.ts";
import {
  FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
  gateStatusFromPublicEntry,
  type FinishWorkGateStatus,
  type FinishWorkPublicGateEntry,
  type FinishWorkReportV11,
} from "./finish-work-report-schema.ts";

export interface ContextSyncReviewNotes {
  feedback: string;
  lastFeedbackAt: string;
  resolved?: boolean;
  reviewerPane?: string | null;
}

export interface ContextSyncPayload {
  summary: string;
  handoffCandidate?: {
    targetPane: string;
    targetAgent: string;
    reason: string;
  };
  outcome: string;
  lastCommit: string | null;
  gatesSummary: string;
  reviewNotes?: ContextSyncReviewNotes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gatesSummaryFromReport(
  gates: Record<string, FinishWorkPublicGateEntry | FinishWorkGateStatus>
): string {
  return Object.entries(gates)
    .map(([name, gate]) => `${name}:${gateStatusFromPublicEntry(gate)}`)
    .join(" ");
}

function reviewNotesFromRaw(raw: Record<string, unknown>): ContextSyncReviewNotes | undefined {
  const review = raw.review;
  if (!isRecord(review) || typeof review.feedback !== "string" || !review.feedback.trim()) {
    return undefined;
  }
  const lastFeedbackAt =
    (typeof review.lastFeedbackAt === "string" ? review.lastFeedbackAt : undefined) ??
    (typeof review.feedbackAt === "string" ? review.feedbackAt : undefined) ??
    "";
  return {
    feedback: review.feedback,
    lastFeedbackAt,
    resolved: typeof review.resolved === "boolean" ? review.resolved : undefined,
    reviewerPane:
      typeof review.reviewerPane === "string"
        ? review.reviewerPane
        : review.reviewerPane === null
          ? null
          : undefined,
  };
}

function handoffCandidateFromRaw(
  raw: Record<string, unknown>
): ContextSyncPayload["handoffCandidate"] {
  const candidate = raw.handoffCandidate;
  if (!isRecord(candidate) || candidate.shouldHandoff !== true) return undefined;
  if (typeof candidate.targetPane !== "string" || typeof candidate.targetAgent !== "string") {
    return undefined;
  }
  return {
    targetPane: candidate.targetPane,
    targetAgent: candidate.targetAgent,
    reason: typeof candidate.reason === "string" ? candidate.reason : "clean finish-work close",
  };
}

export function isFinishWorkHandoffCondition(condition: string): boolean {
  const trimmed = condition.trim();
  return trimmed.startsWith("finish-work:") || trimmed.startsWith("probe:finish-work:");
}

/**
 * Reads the latest finish-work report and builds a context payload for handoff / context-sync.
 */
export function buildContextSyncFromReport(
  projectRoot: string,
  reportPath?: string
): ContextSyncPayload | null {
  const path = reportPath ?? finishWorkReportPath(projectRoot);
  if (!pathExists(path)) return null;

  try {
    const raw = JSON.parse(readText(path)) as Record<string, unknown>;
    const summary = typeof raw.summary === "string" ? raw.summary : "";
    const outcome = typeof raw.outcome === "string" ? raw.outcome : "unknown";
    const gates = raw.gates;
    if (!isRecord(gates)) return null;

    const git = isRecord(raw.git) ? raw.git : null;
    const lastCommit = typeof git?.hash === "string" ? git.hash : null;

    if (raw.schemaVersion !== FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION && !summary && !outcome) {
      return null;
    }

    return {
      summary: summary || `finish-work ${outcome}`,
      handoffCandidate: handoffCandidateFromRaw(raw),
      outcome,
      lastCommit,
      gatesSummary: gatesSummaryFromReport(gates as FinishWorkReportV11["gates"]),
      reviewNotes: reviewNotesFromRaw(raw),
    };
  } catch {
    return null;
  }
}

/**
 * Appends the finish-work report brief to a base handoff or context-sync message.
 */
export function enrichHandoffMessage(
  baseMessage: string,
  payload: ContextSyncPayload | null
): string {
  if (!payload) return baseMessage;

  const lines = [
    baseMessage.trim(),
    "",
    "=== Latest finish-work report ===",
    payload.summary,
    `Outcome: ${payload.outcome} | Gates: ${payload.gatesSummary}`,
  ];

  if (payload.lastCommit) {
    lines.push(`Last commit: ${payload.lastCommit}`);
  }

  if (payload.handoffCandidate) {
    lines.push(
      `Handoff target: ${payload.handoffCandidate.targetAgent} (${payload.handoffCandidate.targetPane})`,
      `Reason: ${payload.handoffCandidate.reason}`
    );
  }

  if (payload.reviewNotes) {
    lines.push("", "=== Review notes ===", payload.reviewNotes.feedback);
    if (payload.reviewNotes.lastFeedbackAt) {
      lines.push(`Reviewed at: ${payload.reviewNotes.lastFeedbackAt}`);
    }
    if (payload.reviewNotes.resolved !== undefined) {
      lines.push(`Resolved: ${payload.reviewNotes.resolved ? "yes" : "no"}`);
    }
    if (payload.reviewNotes.reviewerPane) {
      lines.push(`Reviewer pane: ${payload.reviewNotes.reviewerPane}`);
    }
  }

  lines.push("=== End report ===");
  return lines.join("\n");
}

/** Format only the report brief block (no base message). */
export function formatFinishWorkBrief(payload: ContextSyncPayload): string {
  return enrichHandoffMessage("", payload).replace(/^\s*\n/, "");
}
