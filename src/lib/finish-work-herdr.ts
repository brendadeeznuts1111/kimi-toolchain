import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import {
  findWorkspaceForProject,
  parseHerdrPaneId,
  resolveHerdrPanePath,
} from "./herdr-project-runner.ts";
import { herdrCli, herdrCliJson } from "./herdr-socket.ts";

export interface FinishWorkGateSummary {
  name: string;
  exitCode: number;
  ms: number;
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

  let reviewerPaneId: string | null = null;

  const tabs = await herdrCliJson<{ result?: { tabs?: TabRow[] } }>([
    "tab",
    "list",
    "--workspace",
    workspaceId,
  ]);
  const reviewerTab = tabs.ok
    ? (tabs.json?.result?.tabs || []).find((tab) => tab.label === "reviewer")
    : undefined;

  if (reviewerTab?.tab_id) {
    const panes = await herdrCliJson<{ result?: { panes?: PaneRow[] } }>(["pane", "list"]);
    reviewerPaneId =
      (panes.ok ? panes.json?.result?.panes : [])
        ?.filter((pane) => pane.tab_id === reviewerTab.tab_id)
        .sort((a, b) => String(a.pane_id).localeCompare(String(b.pane_id)))[0]?.pane_id ?? null;
  }

  if (!reviewerPaneId) {
    const created = await herdrCliJson([
      "tab",
      "create",
      "--workspace",
      workspaceId,
      "--no-focus",
      "--label",
      "reviewer",
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
      "needs-review",
    ]);
  }

  report.herdr = { escalated: true, reviewerPaneId };
  return report;
}
