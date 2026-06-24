import { makeDir, pathExists, readText, writeText } from "./bun-io.ts";
import { filePathFromUrl, readableStreamToText } from "./bun-utils.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";
import { withBunNoOrphans } from "./tool-runner.ts";

import { dirname, join } from "path";
import { TOML } from "bun";
import type { GateResult } from "./gate-runner.ts";
import {
  defaultLatmBlock,
  FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
  gateStatusFromPublicEntry,
  type FinishWorkPublicGateEntry,
  type FinishWorkPublicHandoffCandidate,
  type FinishWorkPublicOutcome,
} from "./finish-work-report-schema.ts";
import { gitBranch, gitRevParse } from "./git-helpers.ts";
import { buildContextSyncFromReport, type ContextSyncPayload } from "./context-sync-from-report.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import {
  findWorkspaceForProject,
  parseHerdrPaneId,
  resolveHerdrPanePath,
} from "./herdr-project-runner.ts";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { herdrCli, herdrCliJson } from "./herdr-socket.ts";
import { herdrReportPaneMetadata } from "./herdr-socket-client.ts";

export const WORKSPACE_UPDATED_STATUS = "workspace.updated";

export interface FinishWorkGateSummary {
  name: string;
  exitCode: number;
  ms: number;
  routed?: boolean;
  doctorPaneId?: string;
}

export interface FinishWorkGitSummary {
  attempted: boolean;
  committed: boolean;
  pushed: boolean;
  error: string | null;
  /** Short commit hash at close time (persisted JSON). */
  hash?: string | null;
  /** Full HEAD at close time (persisted JSON; used for stale probe checks). */
  head?: string | null;
}

export interface FinishWorkFollowUpSummary {
  command: string;
  ran: boolean;
  exitCode?: number;
  ms?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface FinishWorkReport {
  schemaVersion: 1;
  tool: "finish-work";
  ok: boolean;
  outcome: "ok" | "escalated" | "failed";
  gateSource: string;
  results: FinishWorkGateSummary[];
  git: FinishWorkGitSummary;
  tree: { clean: boolean; dirty: string[]; untracked?: number };
  followUp?: FinishWorkFollowUpSummary;
  /** ISO timestamp when the report was persisted (handoff probe freshness). */
  completedAt?: string;
  /** Wall-clock duration for the full finish-work run. */
  durationMs?: number;
  /** Commit message passed to finish-work (summary + handoff context). */
  commitMessage?: string | null;
  /** CLI invocation label for LATM consumers. */
  invokedVia?: string;
  /** Git HEAD at close time — handoff probes reject stale reports after new commits. */
  gitHead?: string | null;
  /** Short git hash at close time (derived from gitHead). */
  gitHash?: string | null;
  /** Current branch at close time. */
  gitBranch?: string | null;
  /** Agent pane that ran finish-work (when HERDR_PANE_ID is set). */
  paneId?: string;
  agent?: string;
  session?: string;
  /** Per-gate pass/fail summary for probes and reviewer UI. */
  gates?: Record<string, "pass" | "fail">;
  /** Human-readable close label for probe conditions (`finish-work:clean`, etc.). */
  outcomeLabel?: FinishWorkOutcomeLabel;
  outcomeReason?: string;
  summary?: string;
  handoffCandidate?: FinishWorkPublicHandoffCandidate | null;
  herdr?: {
    escalated: boolean;
    reviewerPaneId?: string | null;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
}

import { FINISH_WORK_REPORT_FILENAME, finishWorkReportPath } from "./finish-work-report-schema.ts";

export { FINISH_WORK_REPORT_FILENAME, finishWorkReportPath };

/** Probe IDs for orchestrator handoff rules (`probe:<id>` or bare `finish-work:<outcome>`). */
export const FINISH_WORK_PROBE_IDS = [
  "finish-work:ok",
  "finish-work:pushed",
  "finish-work:clean",
  "finish-work:dirty",
  "finish-work:committed",
  "finish-work:handoff-ready",
] as const;

export type FinishWorkOutcomeLabel = FinishWorkPublicOutcome;

/** Stable gate keys for persisted `gates` map (e.g. check:fast, effect-gates). */
export function finishWorkGateKey(command: string): string {
  const trimmed = command.trim();
  if (/kimi-doctor\s+--effect-gates\b/.test(trimmed)) return "effect-gates";
  if (/kimi-doctor\s+--dashboard-automation\b/.test(trimmed)) return "dashboard-automation";
  if (/kimi-doctor\s+--dashboard-meta\b/.test(trimmed)) return "dashboard-meta";
  if (/kimi-heal\s+effect\s+audit\b/.test(trimmed)) return "heal-audit";
  const bunRun = trimmed.match(/^bun\s+run\s+(\S+)/);
  if (bunRun?.[1]) return bunRun[1];
  return trimmed.split(/\s+/)[0] ?? "gate";
}

export function finishWorkOutcomeLabel(report: FinishWorkReport): FinishWorkOutcomeLabel {
  if (!report.ok || report.outcome === "failed") return "aborted";
  if (report.outcome === "escalated" || (report.git.pushed && !report.tree.clean)) {
    return report.outcome === "escalated" ? "escalated" : "dirty";
  }
  if (report.tree.clean && report.outcome === "ok") return "clean";
  return "aborted";
}

export type FinishWorkProbeId = (typeof FINISH_WORK_PROBE_IDS)[number];

export function isFinishWorkProbeId(id: string): id is FinishWorkProbeId {
  return (FINISH_WORK_PROBE_IDS as readonly string[]).includes(id);
}

async function resolveFinishWorkAgent(paneId?: string): Promise<string | undefined> {
  if (!paneId) return undefined;
  const got = await herdrCliJson<{
    result?: { pane?: { agent?: string } };
  }>(["pane", "get", paneId]);
  return got.ok ? got.json?.result?.pane?.agent : undefined;
}

function countUntrackedFiles(dirtyLines: string[]): number {
  return dirtyLines.filter((line) => line.startsWith("??")).length;
}

function buildSerializedGates(report: FinishWorkReport): Record<string, FinishWorkPublicGateEntry> {
  const hasHealAudit = report.results.some((row) => row.name === "heal-audit");
  return Object.fromEntries(
    report.results.map((row) => {
      const entry: FinishWorkPublicGateEntry = {
        status: row.exitCode === 0 ? "pass" : "fail",
        durationMs: row.ms,
      };
      if (row.name === "effect-gates" && hasHealAudit) {
        entry.healAuditTriggered = true;
      }
      if (row.name === "heal-audit" && row.doctorPaneId) {
        entry.doctorPane = row.doctorPaneId;
      }
      return [row.name, entry] as const;
    })
  );
}

function normalizeGatesMap(raw: unknown): Record<string, "pass" | "fail"> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value === "pass" ? "pass" : "fail"] as const;
      }
      if (value && typeof value === "object" && "status" in value) {
        const status = gateStatusFromPublicEntry(value as FinishWorkPublicGateEntry);
        return [key, status] as const;
      }
      return null;
    })
    .filter((row): row is [string, "pass" | "fail"] => row !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function buildFinishWorkOutcomeReason(
  report: FinishWorkReport,
  label: FinishWorkOutcomeLabel
): string {
  if (report.outcomeReason) return report.outcomeReason;
  if (label === "clean") {
    return report.git.pushed
      ? "All gates passed + clean tree after push"
      : "All gates passed + clean tree";
  }
  if (label === "dirty" || label === "escalated") {
    return "Dirty tree after push — escalated to reviewer";
  }
  if (label === "partial") return "Gates passed with incomplete git close";
  if (label === "aborted") {
    return report.outcome === "failed" ? "Gate or git failure" : "Finish-work aborted";
  }
  return `Finish-work ${label}`;
}

export function buildFinishWorkSummary(
  report: FinishWorkReport,
  label: FinishWorkOutcomeLabel
): string {
  if (report.summary) return report.summary;
  const hash = report.gitHash ?? report.git.hash ?? "HEAD";
  const message = report.commitMessage?.trim() || "finish-work";
  const treeState = label === "clean" ? "clean" : label;
  const pushNote = report.git.pushed
    ? `pushed ${hash}`
    : report.git.committed
      ? `committed ${hash}`
      : "gates only";
  return `${message} — gates passed, ${pushNote}, tree ${treeState}.`;
}

async function resolveAgentPaneId(workspaceId: string, agentName: string): Promise<string | null> {
  const listed = await herdrCliJson<{
    result?: { panes?: Array<{ pane_id?: string; workspace_id?: string; agent?: string }> };
  }>(["pane", "list", "--workspace", workspaceId]);
  if (!listed.ok) return null;
  const matches = (listed.json?.result?.panes || []).filter(
    (pane) => pane.workspace_id === workspaceId && pane.agent === agentName
  );
  if (matches.length === 0) return null;
  return matches[0]?.pane_id ?? null;
}

async function resolveHandoffCandidate(
  projectRoot: string,
  report: FinishWorkReport,
  label: FinishWorkOutcomeLabel
): Promise<FinishWorkPublicHandoffCandidate | null> {
  if (label !== "clean" || !report.ok || report.outcome !== "ok" || !report.tree.clean) {
    return null;
  }

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) return null;

  const doc = readHerdrDoc(projectRoot);
  const orchestrator = resolveOrchestratorConfig(config, doc);
  const fromAgent = report.agent ?? orchestrator.handoffFrom ?? "kimi";
  const match = findWorkspaceForProject({ ...config, projectPath: projectRoot });
  const fromWorkspace = match.workspaceId;
  if (!fromWorkspace) return null;

  const rule =
    orchestrator.handoffRules.find(
      (row) =>
        row.fromWorkspace === fromWorkspace &&
        row.fromAgent === fromAgent &&
        (row.condition === "finish-work:clean" ||
          row.condition === "probe:finish-work:clean" ||
          row.condition === "finish-work:pushed" ||
          row.condition === "probe:finish-work:pushed")
    ) ?? null;

  const toWorkspace = rule?.toWorkspace ?? fromWorkspace;
  const toAgent = rule?.toAgent ?? orchestrator.handoffTo;
  if (!toAgent) return null;

  if (
    rule &&
    (rule.condition === "finish-work:pushed" || rule.condition === "probe:finish-work:pushed") &&
    !report.git.pushed
  ) {
    return null;
  }

  const targetPane = await resolveAgentPaneId(toWorkspace, toAgent);
  if (!targetPane) return null;

  return {
    targetPane,
    targetAgent: toAgent,
    reason: "clean finish-work close",
    shouldHandoff: true,
  };
}

export async function enrichFinishWorkReport(
  projectRoot: string,
  report: FinishWorkReport
): Promise<FinishWorkReport> {
  const gitHead = report.gitHead ?? report.git.head ?? (await gitRevParse(projectRoot, "HEAD"));
  const gitHash = report.gitHash ?? report.git.hash ?? (gitHead ? gitHead.slice(0, 7) : null);
  const branch = report.gitBranch ?? (await gitBranch(projectRoot));
  const paneId = report.paneId ?? Bun.env.HERDR_PANE_ID;
  const agent = report.agent ?? (await resolveFinishWorkAgent(paneId));
  const outcomeLabel = report.outcomeLabel ?? finishWorkOutcomeLabel(report);
  const handoffCandidate =
    report.handoffCandidate == null
      ? await resolveHandoffCandidate(projectRoot, report, outcomeLabel)
      : report.handoffCandidate;

  const enriched: FinishWorkReport = {
    ...report,
    completedAt: report.completedAt ?? new Date().toISOString(),
    gitHead,
    gitHash,
    gitBranch: branch,
    git: {
      ...report.git,
      hash: gitHash,
      head: gitHead,
    },
    paneId,
    agent,
    session: report.session ?? Bun.env.HERDR_SESSION ?? "",
    gates:
      report.gates ??
      Object.fromEntries(
        report.results.map((row) => [row.name, row.exitCode === 0 ? "pass" : "fail"] as const)
      ),
    outcomeLabel,
    outcomeReason: buildFinishWorkOutcomeReason(report, outcomeLabel),
    summary: buildFinishWorkSummary(report, outcomeLabel),
    handoffCandidate,
    tree: {
      ...report.tree,
      untracked: report.tree.untracked ?? countUntrackedFiles(report.tree.dirty),
    },
  };
  return enriched;
}

/** On-disk JSON shape (public contract for probes and operators). */
export function serializeFinishWorkReport(report: FinishWorkReport): Record<string, unknown> {
  const label = report.outcomeLabel ?? finishWorkOutcomeLabel(report);
  const timestamp = report.completedAt ?? new Date().toISOString();
  const gitHead = report.gitHead ?? report.git.head ?? null;
  const gitHash = report.gitHash ?? report.git.hash ?? (gitHead ? gitHead.slice(0, 7) : null);
  const invokedVia =
    report.invokedVia ??
    `finish-work${report.commitMessage ? ` --message "${report.commitMessage}"` : ""}${
      report.git.pushed ? " --push" : ""
    }`;

  return {
    schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
    tool: report.tool,
    timestamp,
    completedAt: timestamp,
    agent: report.agent,
    paneId: report.paneId,
    session: report.session ?? "",
    durationMs: report.durationMs,
    git: {
      attempted: report.git.attempted,
      committed: report.git.committed,
      pushed: report.git.pushed,
      error: report.git.error,
      hash: gitHash,
      head: gitHead,
      branch: report.gitBranch ?? undefined,
    },
    tree: {
      clean: report.tree.clean,
      dirtyFiles: report.tree.dirty,
      dirty: report.tree.dirty,
      untracked: report.tree.untracked ?? countUntrackedFiles(report.tree.dirty),
    },
    gates: buildSerializedGates(report),
    outcome: label,
    outcomeReason: buildFinishWorkOutcomeReason(report, label),
    review: {
      escalated: Boolean(report.herdr?.escalated),
      reviewerPane: report.herdr?.reviewerPaneId ?? null,
      reportPath: `.kimi/${FINISH_WORK_REPORT_FILENAME}`,
    },
    latm: defaultLatmBlock(invokedVia),
    handoffCandidate: report.handoffCandidate ?? null,
    summary: buildFinishWorkSummary(report, label),
    ok: report.ok,
    pipelineOutcome: report.outcome,
    gateSource: report.gateSource,
    results: report.results,
    followUp: report.followUp,
    herdr: report.herdr,
  };
}

function pipelineOutcomeFromCloseLabel(label: FinishWorkOutcomeLabel): FinishWorkReport["outcome"] {
  if (label === "escalated" || label === "dirty") return "escalated";
  if (label === "aborted") return "failed";
  return "ok";
}

/** Normalize persisted JSON (public or legacy) into internal FinishWorkReport. */
export function normalizeFinishWorkReport(raw: Record<string, unknown>): FinishWorkReport {
  const rawOutcome = raw.outcome;
  const pipelineOutcome =
    raw.pipelineOutcome === "ok" ||
    raw.pipelineOutcome === "escalated" ||
    raw.pipelineOutcome === "failed"
      ? raw.pipelineOutcome
      : rawOutcome === "ok" || rawOutcome === "escalated" || rawOutcome === "failed"
        ? rawOutcome
        : typeof rawOutcome === "string" &&
            (rawOutcome === "clean" ||
              rawOutcome === "dirty" ||
              rawOutcome === "escalated" ||
              rawOutcome === "aborted")
          ? pipelineOutcomeFromCloseLabel(rawOutcome)
          : "failed";

  const closeLabel =
    typeof rawOutcome === "string" &&
    (rawOutcome === "clean" ||
      rawOutcome === "dirty" ||
      rawOutcome === "escalated" ||
      rawOutcome === "aborted" ||
      rawOutcome === "partial")
      ? rawOutcome
      : (raw.outcomeLabel as FinishWorkOutcomeLabel | undefined);

  const rawGit = (raw.git && typeof raw.git === "object" ? raw.git : {}) as Record<string, unknown>;
  const gitHead =
    (typeof rawGit.head === "string" ? rawGit.head : null) ??
    (typeof raw.gitHead === "string" ? raw.gitHead : null);
  const gitHash =
    (typeof rawGit.hash === "string" ? rawGit.hash : null) ??
    (typeof raw.gitHash === "string" ? raw.gitHash : null);

  const timestamp =
    (typeof raw.timestamp === "string" ? raw.timestamp : undefined) ??
    (typeof raw.completedAt === "string" ? raw.completedAt : undefined);

  const rawTree =
    raw.tree && typeof raw.tree === "object" ? (raw.tree as Record<string, unknown>) : null;
  const dirtyFiles = Array.isArray(rawTree?.dirtyFiles)
    ? (rawTree.dirtyFiles as string[])
    : Array.isArray(rawTree?.dirty)
      ? (rawTree.dirty as string[])
      : [];

  const rawHandoff =
    raw.handoffCandidate && typeof raw.handoffCandidate === "object"
      ? (raw.handoffCandidate as FinishWorkPublicHandoffCandidate)
      : null;

  return {
    schemaVersion: 1,
    tool: "finish-work",
    ok: raw.ok === true,
    outcome: pipelineOutcome,
    gateSource: typeof raw.gateSource === "string" ? raw.gateSource : "finishWork",
    results: Array.isArray(raw.results) ? (raw.results as FinishWorkGateSummary[]) : [],
    git: {
      attempted: rawGit.attempted === true,
      committed: rawGit.committed === true,
      pushed: rawGit.pushed === true,
      error: typeof rawGit.error === "string" ? rawGit.error : null,
      hash: gitHash,
      head: gitHead,
    },
    tree: rawTree
      ? {
          clean: rawTree.clean === true,
          dirty: dirtyFiles,
          untracked:
            typeof rawTree.untracked === "number"
              ? rawTree.untracked
              : countUntrackedFiles(dirtyFiles),
        }
      : { clean: true, dirty: [] },
    followUp: raw.followUp as FinishWorkFollowUpSummary | undefined,
    completedAt: timestamp,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    commitMessage: typeof raw.commitMessage === "string" ? raw.commitMessage : undefined,
    invokedVia:
      typeof raw.latm === "object" &&
      raw.latm &&
      typeof (raw.latm as { invokedVia?: string }).invokedVia === "string"
        ? (raw.latm as { invokedVia: string }).invokedVia
        : typeof raw.invokedVia === "string"
          ? raw.invokedVia
          : undefined,
    gitHead,
    gitHash,
    gitBranch: typeof rawGit.branch === "string" ? rawGit.branch : undefined,
    paneId: typeof raw.paneId === "string" ? raw.paneId : undefined,
    agent: typeof raw.agent === "string" ? raw.agent : undefined,
    session: typeof raw.session === "string" ? raw.session : undefined,
    gates: normalizeGatesMap(raw.gates),
    outcomeLabel: closeLabel,
    outcomeReason: typeof raw.outcomeReason === "string" ? raw.outcomeReason : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    handoffCandidate: rawHandoff,
    herdr: raw.herdr as FinishWorkReport["herdr"],
  };
}

export async function persistFinishWorkReport(
  projectRoot: string,
  report: FinishWorkReport
): Promise<string> {
  const enriched = await enrichFinishWorkReport(projectRoot, report);
  const path = finishWorkReportPath(projectRoot);
  makeDir(join(projectRoot, ".kimi"), { recursive: true });
  writeText(path, `${JSON.stringify(serializeFinishWorkReport(enriched), null, 2)}\n`, "utf8");
  return path;
}

export async function loadFinishWorkReport(projectRoot: string): Promise<FinishWorkReport | null> {
  const path = finishWorkReportPath(projectRoot);
  if (!pathExists(path)) return null;
  try {
    return normalizeFinishWorkReport(JSON.parse(readText(path)) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Evaluate a `probe:finish-work:*` / `finish-work:*` handoff condition against the persisted report. */
export async function evaluateFinishWorkProbeCondition(
  probeId: FinishWorkProbeId,
  projectRoot: string
): Promise<{ ok: boolean; message: string }> {
  const report = await loadFinishWorkReport(projectRoot);
  if (!report) {
    return {
      ok: false,
      message: 'no finish-work report — run bun run finish-work --message "..." --push',
    };
  }

  const head = await gitRevParse(projectRoot, "HEAD");
  const reportHead = report.gitHead ?? report.git.head;
  const stale =
    Boolean(reportHead && head && reportHead !== head) && probeId !== "finish-work:dirty";
  if (stale) {
    return {
      ok: false,
      message: "finish-work report stale (HEAD changed since last close)",
    };
  }

  const label = report.outcomeLabel ?? finishWorkOutcomeLabel(report);

  switch (probeId) {
    case "finish-work:dirty":
      if (label === "dirty" || label === "escalated") {
        return {
          ok: true,
          message: `finish-work ${label} — reviewer path (${report.tree.dirty.length} dirty path(s))`,
        };
      }
      return { ok: false, message: "finish-work closed clean — no reviewer handoff" };

    case "finish-work:committed":
      if (!report.git.committed) {
        return { ok: false, message: "finish-work gates passed but nothing committed" };
      }
      if (!report.ok) {
        return { ok: false, message: `finish-work outcome: ${report.outcome}` };
      }
      return {
        ok: true,
        message: `finish-work committed at ${report.gitHash ?? report.gitHead ?? head ?? "HEAD"}`,
      };

    case "finish-work:clean":
      if (!report.ok || report.outcome !== "ok") {
        return {
          ok: false,
          message:
            report.outcome === "escalated"
              ? "finish-work escalated (dirty tree)"
              : `finish-work outcome: ${report.outcome}`,
        };
      }
      if (!report.tree.clean) {
        return { ok: false, message: "finish-work tree not clean" };
      }
      return {
        ok: true,
        message: `finish-work clean at ${report.gitHash ?? report.gitHead ?? head ?? "HEAD"}`,
      };

    case "finish-work:pushed":
      if (!report.ok || report.outcome !== "ok") {
        return {
          ok: false,
          message:
            report.outcome === "escalated"
              ? "finish-work escalated (dirty tree — resolve in reviewer tab)"
              : `finish-work outcome: ${report.outcome}`,
        };
      }
      if (!report.git.pushed) {
        return { ok: false, message: "finish-work gates passed but not pushed — add --push" };
      }
      if (!report.tree.clean) {
        return {
          ok: false,
          message: "finish-work pushed with dirty tree — handoff blocked until clean",
        };
      }
      return {
        ok: true,
        message: `finish-work pushed clean at ${report.gitHash ?? report.gitHead ?? head ?? "HEAD"}`,
      };

    case "finish-work:ok":
      if (!report.ok || report.outcome !== "ok") {
        const detail =
          report.outcome === "escalated"
            ? "finish-work escalated (dirty tree — resolve in reviewer tab)"
            : `finish-work outcome: ${report.outcome}`;
        return { ok: false, message: detail };
      }
      return {
        ok: true,
        message: `finish-work ok (${report.results.length} gates)`,
      };

    case "finish-work:handoff-ready":
      if (!report.handoffCandidate?.shouldHandoff) {
        return {
          ok: false,
          message: report.handoffCandidate
            ? "handoff candidate present but shouldHandoff=false"
            : "no handoff candidate — outcome not clean or rule unresolved",
        };
      }
      return {
        ok: true,
        message: `handoff ready → ${report.handoffCandidate.targetAgent}@${report.handoffCandidate.targetPane}`,
      };
  }
}

/** Load persisted public v1.1 JSON without normalizing to internal pipeline shape. */
export async function loadFinishWorkReportPublic(
  projectRoot: string
): Promise<Record<string, unknown> | null> {
  const path = finishWorkReportPath(projectRoot);
  if (!pathExists(path)) return null;
  try {
    return JSON.parse(readText(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const REVIEWER_FEEDBACK_PROCESSED_STATUS = "reviewer.feedback.processed";

export interface FinishWorkReviewerFeedback {
  message: string;
  resolved?: boolean;
  reviewerPane?: string;
}

export interface AppendReviewerFeedbackOptions {
  /** Run agentsTab context-sync with finish-work brief after persisting feedback. */
  triggerContextSync?: boolean;
  /** Emit pane metadata for watch-events (`reviewer.feedback.processed`). */
  emitProcessedEvent?: boolean;
}

export interface AppendReviewerFeedbackResult {
  path: string;
  payload: ContextSyncPayload | null;
  contextSyncWarnings: string[];
}

async function triggerReviewerFeedbackContextSync(
  projectRoot: string
): Promise<{ warnings: string[] }> {
  if (Bun.env.HERDR_ENV !== "1") return { warnings: [] };

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) return { warnings: [] };

  const full = { ...config, projectPath: projectRoot };
  const match = findWorkspaceForProject(full);
  const sync = syncAgentsTabContext(full, full.agentsTab?.panes, match.workspaceId, {
    appendFinishWorkBrief: true,
  });
  return { warnings: sync.warnings };
}

function emitReviewerFeedbackProcessed(paneId: string): void {
  herdrReportPaneMetadata({
    paneId,
    source: "kimi-toolchain:reviewer",
    customStatus: REVIEWER_FEEDBACK_PROCESSED_STATUS,
    ttlMs: 60_000,
  });
}

/** Append reviewer feedback into the persisted report `review` block (v1.1). */
export async function appendReviewerFeedback(
  projectRoot: string,
  feedback: FinishWorkReviewerFeedback,
  options: AppendReviewerFeedbackOptions = {}
): Promise<AppendReviewerFeedbackResult> {
  const path = finishWorkReportPath(projectRoot);
  if (!pathExists(path)) {
    throw new Error(`missing finish-work report: ${path}`);
  }

  const raw = JSON.parse(readText(path)) as Record<string, unknown>;
  const review: Record<string, unknown> =
    raw.review && typeof raw.review === "object"
      ? { ...(raw.review as Record<string, unknown>) }
      : {
          escalated: false,
          reviewerPane: feedback.reviewerPane ?? null,
          reportPath: `.kimi/${FINISH_WORK_REPORT_FILENAME}`,
        };

  const stampedAt = new Date().toISOString();
  review.feedback = feedback.message;
  review.lastFeedbackAt = stampedAt;
  review.feedbackAt = stampedAt;
  if (feedback.resolved !== undefined) review.resolved = feedback.resolved;
  if (feedback.reviewerPane) review.reviewerPane = feedback.reviewerPane;

  raw.review = review;
  writeText(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const emitEvent = options.emitProcessedEvent ?? true;
  const paneId = feedback.reviewerPane ?? Bun.env.HERDR_PANE_ID;
  if (emitEvent && paneId) {
    emitReviewerFeedbackProcessed(paneId);
  }

  const triggerSync = options.triggerContextSync ?? true;
  const contextSyncWarnings = triggerSync
    ? (await triggerReviewerFeedbackContextSync(projectRoot)).warnings
    : [];

  return {
    path,
    payload: buildContextSyncFromReport(projectRoot),
    contextSyncWarnings,
  };
}

export function finishWorkOutcome(
  ok: boolean,
  pushed: boolean,
  treeClean: boolean
): FinishWorkReport["outcome"] {
  if (!ok) return "failed";
  if (pushed && !treeClean) return "escalated";
  return "ok";
}

export function shouldEscalateToReviewer(report: FinishWorkReport): boolean {
  return report.ok && report.git.pushed && !report.tree.clean;
}

export const FINISH_WORK_NEEDS_REVIEW_STATUS = "needs-review";

export function isPaneBlockedForReview(pane: {
  agent?: string;
  agent_status?: string;
  custom_status?: string;
}): boolean {
  if (pane.agent_status === "blocked" && pane.agent === "finish-work") return true;
  return pane.agent_status === "blocked" && pane.custom_status === FINISH_WORK_NEEDS_REVIEW_STATUS;
}

/** Signal workspace change to orchestrator event watcher via pane metadata. */
export async function emitWorkspaceUpdatedMetadata(): Promise<void> {
  const paneId = Bun.env.HERDR_PANE_ID;
  if (!paneId) return;

  if (Bun.env.HERDR_ENV === "1") {
    const got = await herdrCliJson<{
      result?: {
        pane?: { agent?: string; agent_status?: string; custom_status?: string };
      };
    }>(["pane", "get", paneId]);
    const pane = got.ok ? got.json?.result?.pane : undefined;
    if (pane && isPaneBlockedForReview(pane)) return;
  }

  herdrReportPaneMetadata({
    paneId,
    source: "finish-work",
    customStatus: WORKSPACE_UPDATED_STATUS,
    ttlMs: 60_000,
  });
}

export const FINISH_WORK_DOCTOR_GATE_TIMEOUT_MS = 120_000;

export type FinishWorkHerdrDeps = {
  herdrCli?: typeof herdrCli;
  herdrCliJson?: typeof herdrCliJson;
};

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function paneRunCommand(command: string): string {
  const path = resolveHerdrPanePath();
  const payload = path
    ? `export PATH="${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"; ${command}`
    : command;
  return `sh -lc ${shellQuote(payload)}`;
}

type PaneRow = {
  pane_id?: string;
  tab_id?: string;
  workspace_id?: string;
  label?: string;
};

type TabRow = {
  tab_id?: string;
  label?: string;
  workspace_id?: string;
};

function readHerdrDoc(projectRoot: string): Record<string, unknown> | null {
  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.sourcePath) return null;
  return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
}

export function shouldRouteGateThroughDoctor(command: string): boolean {
  return /^kimi-heal\s+effect\s+audit\b/.test(command.trim());
}

export function finishWorkLocalGatesForced(): boolean {
  const value = Bun.env.KIMI_FINISH_WORK_LOCAL_GATES;
  return value === "1" || value === "true";
}

export function shouldRunGateInDoctorPane(command: string): boolean {
  return (
    Bun.env.HERDR_ENV === "1" &&
    !finishWorkLocalGatesForced() &&
    shouldRouteGateThroughDoctor(command)
  );
}

export function shouldSkipFinishWorkFollowUp(options: {
  skipGit: boolean;
  pushed: boolean;
  treeClean: boolean;
}): { skip: boolean; reason?: string } {
  if (options.skipGit) return { skip: true, reason: "skip-git" };
  if (!options.pushed) return { skip: true, reason: "push required" };
  if (!options.treeClean) return { skip: true, reason: "dirty tree escalated" };
  return { skip: false };
}

export async function resolveTabPrimaryPane(
  workspaceId: string,
  tabLabel: string,
  deps: FinishWorkHerdrDeps = {}
): Promise<{ paneId: string | null; error?: string }> {
  const cliJson = deps.herdrCliJson ?? herdrCliJson;

  const tabs = await cliJson<{ result?: { tabs?: TabRow[] } }>([
    "tab",
    "list",
    "--workspace",
    workspaceId,
  ]);
  if (!tabs.ok) {
    return { paneId: null, error: tabs.error || "tab list failed" };
  }

  const tab = (tabs.json?.result?.tabs || []).find((row) => row.label === tabLabel);
  if (!tab?.tab_id) {
    return { paneId: null, error: `${tabLabel} tab not found` };
  }

  const panes = await cliJson<{ result?: { panes?: PaneRow[] } }>(["pane", "list"]);
  if (!panes.ok) {
    return { paneId: null, error: panes.error || "pane list failed" };
  }

  const paneId =
    (panes.json?.result?.panes || [])
      .filter((pane) => pane.tab_id === tab.tab_id)
      .sort((a, b) => String(a.pane_id).localeCompare(String(b.pane_id)))[0]?.pane_id ?? null;

  if (!paneId) {
    return { paneId: null, error: `${tabLabel} tab has no panes` };
  }

  return { paneId };
}

export async function resolveDoctorPaneId(
  projectRoot: string,
  deps: FinishWorkHerdrDeps = {}
): Promise<{ paneId: string | null; doctorTab: string; error?: string }> {
  const override = Bun.env.HERDR_DOCTOR_PANE_ID;
  if (override) {
    return { paneId: override, doctorTab: "doctor" };
  }

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) {
    return { paneId: null, doctorTab: "doctor", error: "no enabled [herdr] profile" };
  }

  const doc = readHerdrDoc(projectRoot);
  const orchestrator = resolveOrchestratorConfig(config, doc);
  const doctorTab = orchestrator.doctorTab;

  const match = findWorkspaceForProject({ ...config, projectPath: projectRoot });
  if (!match.workspaceId) {
    return {
      paneId: null,
      doctorTab,
      error: `workspace not open (${match.reason})`,
    };
  }

  const resolved = await resolveTabPrimaryPane(match.workspaceId, doctorTab, deps);
  if (!resolved.paneId) {
    return {
      paneId: null,
      doctorTab,
      error: resolved.error || `doctor tab not found — run herdr-project reconcile`,
    };
  }

  return { paneId: resolved.paneId, doctorTab };
}

function finishWorkGateLogPath(projectRoot: string, gateName: string): string {
  const safe = gateName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return join(projectRoot, ".kimi", `finish-work-gate-${safe}.log`);
}

function resolveFinishWorkGateRunnerScript(projectRoot: string): string {
  const local = join(projectRoot, "scripts", "finish-work-gate-run.ts");
  if (pathExists(local)) return local;
  return filePathFromUrl(new URL("../../scripts/finish-work-gate-run.ts", import.meta.url).href);
}

/**
 * Run a shell gate command with stdout/stderr captured to a log file via Bun.spawn.
 *
 * Pipes both streams then writes the merged text with `Bun.write` — assigning the same
 * `Bun.file` to stdout and stderr drops bytes on Bun 1.4 when both streams are active.
 *
 * @see BUN_CHILD_PROCESS_DOC_URL — spawn stdio; log sink via `Bun.write(logPath, …)`
 */
export async function spawnGateCommandToLog(
  command: string,
  logPath: string,
  options: { cwd?: string; env?: Record<string, string | undefined> } = {}
): Promise<number> {
  makeDir(dirname(logPath), { recursive: true });
  const proc = Bun.spawn(withBunNoOrphans(["sh", "-lc", command]), {
    cwd: options.cwd ?? process.cwd(),
    env: withNoOrphansEnv(options.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  await Bun.write(logPath, `${stdout}${stderr}`);
  return exitCode;
}

function parseDoctorGateMarker(output: string, nonce: string): number | null {
  const match = output.match(new RegExp(`__KIMI_FW_GATE_${nonce}:(\\d+)__`));
  if (!match) return null;
  return Number(match[1]);
}

export type DoctorPaneGateResult = GateResult & { routed: true; doctorPaneId?: string };

export async function runDoctorPaneGate(
  projectRoot: string,
  name: string,
  command: string,
  deps: FinishWorkHerdrDeps = {}
): Promise<DoctorPaneGateResult> {
  const start = Bun.nanoseconds();
  const cli = deps.herdrCli ?? herdrCli;
  const resolved = await resolveDoctorPaneId(projectRoot, deps);

  if (!resolved.paneId) {
    return {
      name,
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: "",
      stderr: resolved.error
        ? `Cannot route ${name} to doctor pane: ${resolved.error}`
        : "doctor pane not resolved",
      routed: true,
    };
  }

  const doctorPaneId = resolved.paneId;
  const nonce = Bun.randomUUIDv7().replace(/-/g, "");
  const logPath = finishWorkGateLogPath(projectRoot, name);
  makeDir(join(projectRoot, ".kimi"), { recursive: true });

  const runnerScript = resolveFinishWorkGateRunnerScript(projectRoot);
  const gateInvocation = `bun ${shellQuote(runnerScript)} --log ${shellQuote(logPath)} --command ${shellQuote(command)}`;
  const wrapped = [gateInvocation, `EC=$?`, `echo __KIMI_FW_GATE_${nonce}:$EC__`, "exit 0"].join(
    "; "
  );

  const ran = await cli(["pane", "run", doctorPaneId, paneRunCommand(wrapped)]);
  if (!ran.ok) {
    return {
      name,
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: ran.stdout,
      stderr: ran.stderr
        ? `herdr pane run failed on doctor ${doctorPaneId}: ${ran.stderr}`
        : "pane run failed",
      doctorPaneId,
      routed: true,
    };
  }

  const wait = await cli([
    "wait",
    "output",
    doctorPaneId,
    "--match",
    `__KIMI_FW_GATE_${nonce}:[0-9]+__`,
    "--regex",
    "--timeout",
    String(FINISH_WORK_DOCTOR_GATE_TIMEOUT_MS),
  ]);

  const markerExit = parseDoctorGateMarker(`${wait.stdout}\n${wait.stderr}`, nonce);
  const log = pathExists(logPath) ? await Bun.file(logPath).text() : "";

  if (!wait.ok || markerExit == null) {
    return {
      name,
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: log,
      stderr:
        wait.stderr || wait.stdout
          ? `${name} timed out in doctor pane ${doctorPaneId} after ${FINISH_WORK_DOCTOR_GATE_TIMEOUT_MS}ms: ${wait.stderr || wait.stdout}`
          : "doctor gate wait timed out",
      doctorPaneId,
      routed: true,
    };
  }

  return {
    name,
    exitCode: markerExit,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout: log,
    stderr: "",
    doctorPaneId,
    routed: true,
  };
}

export async function escalateFinishWorkToReviewer(
  projectRoot: string,
  report: FinishWorkReport
): Promise<FinishWorkReport> {
  if (!shouldEscalateToReviewer(report)) {
    return report;
  }

  if (Bun.env.HERDR_ENV !== "1") {
    report.herdr = { escalated: false, skipped: true, reason: "not inside herdr" };
    return report;
  }

  const config = discoverHerdrProjectConfig(projectRoot);
  if (!config?.enabled) {
    report.herdr = { escalated: false, skipped: true, reason: "no enabled [herdr] profile" };
    return report;
  }

  const match = findWorkspaceForProject({ ...config, projectPath: projectRoot });
  if (!match.workspaceId) {
    report.herdr = {
      escalated: false,
      skipped: true,
      reason: `workspace not open (${match.reason})`,
    };
    return report;
  }

  const workspaceId = match.workspaceId;
  const reportPath = await persistFinishWorkReport(projectRoot, report);

  const reviewerCommand = `bun run scripts/reviewer-pane.ts --report-file ${shellQuote(reportPath)}`;

  const doc = readHerdrDoc(projectRoot);
  const orchestrator = resolveOrchestratorConfig(config, doc);
  const reviewerTabLabel = orchestrator.reviewerTab;

  let reviewerPaneId: string | null = null;
  const existing = await resolveTabPrimaryPane(workspaceId, reviewerTabLabel);
  reviewerPaneId = existing.paneId;

  if (!reviewerPaneId) {
    const created = await herdrCliJson([
      "tab",
      "create",
      "--workspace",
      workspaceId,
      "--no-focus",
      "--label",
      reviewerTabLabel,
    ]);
    if (!created.ok) {
      report.herdr = { escalated: false, error: created.error || "reviewer tab create failed" };
      return report;
    }
    reviewerPaneId = parseHerdrPaneId(
      created.json as { result?: Record<string, unknown> } | null,
      null
    );
  }

  if (!reviewerPaneId) {
    report.herdr = { escalated: false, error: "reviewer pane id not resolved" };
    return report;
  }

  const ran = await herdrCli(["pane", "run", reviewerPaneId, paneRunCommand(reviewerCommand)]);
  if (!ran.ok) {
    report.herdr = {
      escalated: false,
      reviewerPaneId,
      error: ran.stderr || ran.stdout || "pane run failed",
    };
    return report;
  }

  const sourcePane = Bun.env.HERDR_PANE_ID;
  if (sourcePane) {
    await herdrCli([
      "pane",
      "report-agent",
      sourcePane,
      "--source",
      "kimi-toolchain:finish-work",
      "--agent",
      "finish-work",
      "--state",
      "blocked",
      "--message",
      "Review dirty tree after push",
      "--custom-status",
      FINISH_WORK_NEEDS_REVIEW_STATUS,
    ]);
    // report_metadata wins display over stale workspace.updated TTL from prior emits.
    herdrReportPaneMetadata({
      paneId: sourcePane,
      source: "kimi-toolchain:finish-work",
      customStatus: FINISH_WORK_NEEDS_REVIEW_STATUS,
    });
  }

  report.herdr = { escalated: true, reviewerPaneId };
  return report;
}
