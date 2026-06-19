/**
 * Scaffold slim copy — self-contained Herdr close-loop for finish-work.
 * Live kimi-toolchain uses src/lib/finish-work-herdr.ts (shared with herdr-project).
 */

import { makeDir, pathExists, readText, writeText } from "./lib/bun-io.ts";
import { readableStreamToText } from "./lib/bun-utils.ts";
import { join } from "node:path";
import { TOML } from "bun";

export interface FinishWorkReport {
  schemaVersion: 1;
  tool: "finish-work";
  ok: boolean;
  outcome: "ok" | "escalated" | "failed";
  gateSource: string;
  results: Array<{ name: string; exitCode: number; ms: number }>;
  git: {
    attempted: boolean;
    committed: boolean;
    pushed: boolean;
    error: string | null;
  };
  tree: { clean: boolean; dirty: string[] };
  followUp?: {
    command: string;
    ran: boolean;
    exitCode?: number;
    ms?: number;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
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

async function herdrCli(args: string[]) {
  const proc = Bun.spawn(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function herdrCliJson<T = unknown>(args: string[]) {
  const result = await herdrCli(args);
  if (!result.ok) {
    return { ok: false as const, json: null as T | null, error: result.stderr || result.stdout };
  }
  try {
    return { ok: true as const, json: JSON.parse(result.stdout) as T, error: null };
  } catch {
    return { ok: false as const, json: null as T | null, error: "invalid JSON from herdr CLI" };
  }
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parsePaneId(payload: { result?: Record<string, unknown> } | null): string | null {
  const result = payload?.result;
  const pane = result?.pane as { pane_id?: string } | undefined;
  const rootPane = (result?.root_pane || result?.rootPane) as { pane_id?: string } | undefined;
  return pane?.pane_id || rootPane?.pane_id || null;
}

function readHerdrProfile(projectRoot: string): {
  enabled: boolean;
  workspaceLabel: string | null;
} | null {
  const dxConfig = join(projectRoot, "dx.config.toml");
  const flat = join(projectRoot, ".dx", "herdr.toml");
  const path = pathExists(flat) ? flat : pathExists(dxConfig) ? dxConfig : null;
  if (!path) return null;

  const doc = TOML.parse(readText(path)) as Record<string, unknown>;
  const section =
    doc.herdr && typeof doc.herdr === "object"
      ? (doc.herdr as Record<string, unknown>)
      : path.endsWith("herdr.toml")
        ? doc
        : null;
  if (!section || section.enabled === false) return null;
  return {
    enabled: true,
    workspaceLabel: typeof section.workspaceLabel === "string" ? section.workspaceLabel : null,
  };
}

async function findWorkspaceId(
  projectRoot: string,
  workspaceLabel: string | null
): Promise<{ workspaceId: string | null; reason: string }> {
  const panes = await herdrCliJson<{ result?: { panes?: Array<Record<string, string>> } }>([
    "pane",
    "list",
  ]);
  if (!panes.ok) return { workspaceId: null, reason: panes.error || "pane list failed" };

  const rows = panes.json?.result?.panes || [];
  const byCwd = rows.find(
    (pane) => pane.cwd === projectRoot || pane.foreground_cwd === projectRoot
  );
  if (byCwd?.workspace_id) return { workspaceId: byCwd.workspace_id, reason: "cwd" };

  if (workspaceLabel) {
    const workspaces = await herdrCliJson<{
      result?: { workspaces?: Array<Record<string, string>> };
    }>(["workspace", "list"]);
    if (workspaces.ok) {
      const match = workspaces.json?.result?.workspaces?.find((ws) => ws.label === workspaceLabel);
      if (match?.workspace_id) return { workspaceId: match.workspace_id, reason: "label" };
    }
  }

  return { workspaceId: null, reason: "not_found" };
}

export async function escalateFinishWorkToReviewer(
  projectRoot: string,
  report: FinishWorkReport
): Promise<FinishWorkReport> {
  if (!shouldEscalateToReviewer(report)) return report;

  if (process.env.HERDR_ENV !== "1") {
    report.herdr = { escalated: false, skipped: true, reason: "not inside herdr" };
    return report;
  }

  const profile = readHerdrProfile(projectRoot);
  if (!profile) {
    report.herdr = { escalated: false, skipped: true, reason: "no enabled [herdr] profile" };
    return report;
  }

  const match = await findWorkspaceId(projectRoot, profile.workspaceLabel);
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
  makeDir(reportDir, { recursive: true });
  const reportPath = join(reportDir, "finish-work-report.json");
  writeText(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const reviewerCommand = `bun run scripts/reviewer-pane.ts --report-file ${shellQuote(reportPath)}`;
  const panePayload = `sh -lc ${shellQuote(reviewerCommand)}`;

  let reviewerPaneId: string | null = null;
  const tabs = await herdrCliJson<{
    result?: { tabs?: Array<{ tab_id?: string; label?: string }> };
  }>(["tab", "list", "--workspace", workspaceId]);
  const reviewerTab = tabs.ok
    ? tabs.json?.result?.tabs?.find((tab) => tab.label === "reviewer")
    : undefined;

  if (reviewerTab?.tab_id) {
    const panes = await herdrCliJson<{ result?: { panes?: Array<Record<string, string>> } }>([
      "pane",
      "list",
    ]);
    reviewerPaneId = panes.ok
      ? ((panes.json?.result?.panes || [])
          .filter((pane) => pane.tab_id === reviewerTab.tab_id)
          .sort((a, b) => String(a.pane_id).localeCompare(String(b.pane_id)))[0]?.pane_id ?? null)
      : null;
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
    reviewerPaneId = parsePaneId(created.json);
  }

  if (!reviewerPaneId) {
    report.herdr = { escalated: false, error: "reviewer pane id not resolved" };
    return report;
  }

  const ran = await herdrCli(["pane", "run", reviewerPaneId, panePayload]);
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
      "finish-work",
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
