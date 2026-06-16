import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TOML } from "bun";
import type { GateResult } from "./gate-runner.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
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
  tree: { clean: boolean; dirty: string[] };
  followUp?: FinishWorkFollowUpSummary;
  herdr?: {
    escalated: boolean;
    reviewerPaneId?: string | null;
    skipped?: boolean;
    reason?: string;
    error?: string;
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
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) return;

  if (process.env.HERDR_ENV === "1") {
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
  return TOML.parse(readFileSync(config.sourcePath, "utf8")) as Record<string, unknown>;
}

export function shouldRouteGateThroughDoctor(command: string): boolean {
  return /^kimi-heal\s+effect\s+audit\b/.test(command.trim());
}

export function finishWorkLocalGatesForced(): boolean {
  const value = process.env.KIMI_FINISH_WORK_LOCAL_GATES;
  return value === "1" || value === "true";
}

export function shouldRunGateInDoctorPane(command: string): boolean {
  return (
    process.env.HERDR_ENV === "1" &&
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
  const override = process.env.HERDR_DOCTOR_PANE_ID;
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
      stderr: resolved.error || "doctor pane not resolved",
      routed: true,
    };
  }

  const doctorPaneId = resolved.paneId;
  const nonce = Bun.randomUUIDv7().replace(/-/g, "");
  const logPath = finishWorkGateLogPath(projectRoot, name);
  mkdirSync(join(projectRoot, ".kimi"), { recursive: true });

  const wrapped = [
    `rm -f ${shellQuote(logPath)}`,
    `${command} > ${shellQuote(logPath)} 2>&1`,
    `EC=$?`,
    `echo __KIMI_FW_GATE_${nonce}:$EC__`,
    "exit 0",
  ].join("; ");

  const ran = await cli(["pane", "run", doctorPaneId, paneRunCommand(wrapped)]);
  if (!ran.ok) {
    return {
      name,
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: ran.stdout,
      stderr: ran.stderr || "pane run failed",
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
  const log = existsSync(logPath) ? await Bun.file(logPath).text() : "";

  if (!wait.ok || markerExit == null) {
    return {
      name,
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: log,
      stderr: wait.stderr || wait.stdout || "doctor gate wait timed out",
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

  if (process.env.HERDR_ENV !== "1") {
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
  const reportDir = join(projectRoot, ".kimi");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, "finish-work-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

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

  const sourcePane = process.env.HERDR_PANE_ID;
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
