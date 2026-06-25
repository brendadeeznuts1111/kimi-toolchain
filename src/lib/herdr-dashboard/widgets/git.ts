/**
 * herdr-dashboard/widgets/git.ts — Session-scoped git status + recent commits widget.
 */

import { TOML } from "bun";
import { readText } from "../../bun-io.ts";
import { discoverHerdrProjectConfig } from "../../herdr-project-config.ts";
import { gitBranch, gitLog, gitStatus, isGitRepo } from "../../git-helpers.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
  type ResolvedRemoteHost,
} from "../../herdr-orchestrator-config.ts";
import { friendlySshError, sshExec } from "../../herdr-orchestrator.ts";
import type { DashboardSessionCatalogEntry } from "../sessions.ts";
import type { DashboardMetaDiscovery } from "../discovery/meta.ts";
import { dashboardWidgetSessionLabel, resolveDashboardWidgetSession } from "./session.ts";

export const GIT_WIDGET_DEFAULT_COMMITS = 10;
export const GIT_WIDGET_MAX_COMMITS = 50;
export const GIT_WIDGET_WORKSPACE_SCOPE = "*";

const GIT_LOG_FORMAT = "%h\t%s\t%aI";

export interface DashboardGitStatusRow {
  xy: string;
  path: string;
}

export interface DashboardGitCommitRow {
  sha: string;
  subject: string;
  date: string;
}

export interface DashboardGitWidgetData {
  branch: string;
  dirty: boolean;
  changedCount: number;
  status: DashboardGitStatusRow[];
  commits: DashboardGitCommitRow[];
  commitLimit: number;
}

export interface DashboardGitWidgetFetchOptions {
  session?: string;
  commits?: number;
  catalog?: DashboardMetaDiscovery["sessionCatalog"];
}

export type DashboardGitWidgetResponse =
  | {
      ok: true;
      widget: "git";
      session: string;
      sessionLabel: string;
      available: true;
      data: DashboardGitWidgetData;
      fetchedAt: string;
    }
  | {
      ok: false;
      widget: "git";
      session: string;
      sessionLabel: string;
      available: false;
      error: string;
      fetchedAt: string;
    };

export interface GitWidgetDeps {
  readLocalGit: (
    projectPath: string,
    commitLimit: number
  ) => Promise<{ ok: true; data: DashboardGitWidgetData } | { ok: false; error: string }>;
  readRemoteGit: (
    resolved: ResolvedRemoteHost,
    hostLabel: string,
    projectPath: string,
    commitLimit: number
  ) => Promise<{ ok: true; data: DashboardGitWidgetData } | { ok: false; error: string }>;
}

const defaultDeps: GitWidgetDeps = {
  readLocalGit: readLocalGitState,
  readRemoteGit: readRemoteGitState,
};

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clampGitWidgetCommits(commits: number | undefined): number {
  const raw =
    typeof commits === "number" && Number.isFinite(commits)
      ? Math.floor(commits)
      : GIT_WIDGET_DEFAULT_COMMITS;
  return Math.min(GIT_WIDGET_MAX_COMMITS, Math.max(1, raw));
}

export function parseGitStatusPorcelain(text: string): DashboardGitStatusRow[] {
  const rows: DashboardGitStatusRow[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3).trim();
    const path = rest.includes(" -> ") ? (rest.split(" -> ").pop()?.trim() ?? rest) : rest;
    rows.push({ xy, path });
  }
  return rows;
}

export function parseGitLogFormatted(text: string): DashboardGitCommitRow[] {
  const rows: DashboardGitCommitRow[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    rows.push({
      sha: parts[0] ?? "",
      subject: parts[1] ?? "",
      date: parts[2] ?? "",
    });
  }
  return rows;
}

export function isRemoteProjectPathMissing(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("no such file or directory") ||
    lower.includes("cannot access") ||
    lower.includes("not a directory")
  );
}

export function resolveRemoteGitDirectoryError(output: string, hostLabel: string): string {
  if (!output.trim() || isRemoteProjectPathMissing(output)) {
    return "project path not found on remote host";
  }
  return friendlySshError(output, hostLabel);
}

function buildGitWidgetData(
  branch: string,
  statusText: string,
  logText: string,
  commitLimit: number
): DashboardGitWidgetData {
  const status = parseGitStatusPorcelain(statusText);
  return {
    branch,
    dirty: status.length > 0,
    changedCount: status.length,
    status,
    commits: parseGitLogFormatted(logText),
    commitLimit,
  };
}

async function readLocalGitState(
  projectPath: string,
  commitLimit: number
): Promise<{ ok: true; data: DashboardGitWidgetData } | { ok: false; error: string }> {
  const repo = await isGitRepo(projectPath);
  if (!repo) {
    return { ok: false, error: "not a git repository" };
  }

  const branch = await gitBranch(projectPath);
  const statusText = await gitStatus(projectPath);
  const logText = await gitLog(projectPath, GIT_LOG_FORMAT, `-n ${commitLimit}`);
  return {
    ok: true,
    data: buildGitWidgetData(branch, statusText, logText, commitLimit),
  };
}

async function runRemoteGitCommand(
  resolved: ResolvedRemoteHost,
  projectPath: string,
  args: string[]
): Promise<{ ok: true; output: string } | { ok: false; output: string }> {
  const result = await sshExec(resolved, ["git", "-C", projectPath, ...args]);
  if (!result.ok) return { ok: false, output: result.output };
  return { ok: true, output: result.output };
}

async function readRemoteGitState(
  resolved: ResolvedRemoteHost,
  hostLabel: string,
  projectPath: string,
  commitLimit: number
): Promise<{ ok: true; data: DashboardGitWidgetData } | { ok: false; error: string }> {
  const dirCheck = await sshExec(resolved, ["test", "-d", projectPath]);
  if (!dirCheck.ok) {
    return { ok: false, error: resolveRemoteGitDirectoryError(dirCheck.output, hostLabel) };
  }

  const repoCheck = await runRemoteGitCommand(resolved, projectPath, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (!repoCheck.ok) {
    return { ok: false, error: friendlySshError(repoCheck.output, hostLabel) };
  }
  if (repoCheck.output.trim() !== "true") {
    return { ok: false, error: "not a git repository" };
  }

  const branchResult = await runRemoteGitCommand(resolved, projectPath, [
    "branch",
    "--show-current",
  ]);
  if (!branchResult.ok) {
    return { ok: false, error: friendlySshError(branchResult.output, hostLabel) };
  }

  const statusResult = await runRemoteGitCommand(resolved, projectPath, ["status", "--porcelain"]);
  if (!statusResult.ok) {
    return { ok: false, error: friendlySshError(statusResult.output, hostLabel) };
  }

  const logResult = await runRemoteGitCommand(resolved, projectPath, [
    "log",
    `-n`,
    String(commitLimit),
    `--format=${GIT_LOG_FORMAT}`,
  ]);
  if (!logResult.ok) {
    return { ok: false, error: friendlySshError(logResult.output, hostLabel) };
  }

  const branch = branchResult.output.trim() || "unknown";
  return {
    ok: true,
    data: buildGitWidgetData(branch, statusResult.output, logResult.output, commitLimit),
  };
}

function unavailableResponse(
  session: string,
  error: string,
  fetchedAt: string
): DashboardGitWidgetResponse {
  return {
    ok: false,
    widget: "git",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    available: false,
    error,
    fetchedAt,
  };
}

async function collectGitState(
  entry: DashboardSessionCatalogEntry,
  projectPath: string,
  commitLimit: number,
  deps: GitWidgetDeps
): Promise<{ ok: true; data: DashboardGitWidgetData } | { ok: false; error: string }> {
  if (entry.host === "(local)") {
    return deps.readLocalGit(projectPath, commitLimit);
  }

  const config = discoverHerdrProjectConfig(projectPath);
  if (!config?.enabled) {
    return { ok: false, error: "no [herdr] profile" };
  }
  const doc = loadOrchestratorDocument(config.sourcePath ?? null);
  const orchConfig = resolveOrchestratorConfig({ ...config, projectPath }, doc);
  const resolvedHosts = normalizeRemoteHostConfig(
    orchConfig.remoteHosts,
    orchConfig.remoteDefaults
  );
  const resolved = resolvedHosts[entry.host];
  if (!resolved) {
    return { ok: false, error: `remote host "${entry.host}" not configured` };
  }
  return deps.readRemoteGit(resolved, entry.host, projectPath, commitLimit);
}

/** Fetch git status + recent commits for one Herdr session (SWR cache scope `*`). */
export async function fetchDashboardGitWidget(
  projectPath: string,
  options: DashboardGitWidgetFetchOptions = {},
  deps: Partial<GitWidgetDeps> = {}
): Promise<DashboardGitWidgetResponse> {
  const merged = { ...defaultDeps, ...deps };
  const fetchedAt = new Date().toISOString();
  const session = options.session?.trim() ?? "";
  const commitLimit = clampGitWidgetCommits(options.commits);

  const resolved = resolveDashboardWidgetSession(session, options.catalog);
  if (!resolved.ok) {
    return unavailableResponse(session, resolved.error, fetchedAt);
  }

  const collected = await collectGitState(resolved.entry, projectPath, commitLimit, merged);
  if (!collected.ok) {
    return unavailableResponse(session, collected.error, fetchedAt);
  }

  return {
    ok: true,
    widget: "git",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    available: true,
    data: collected.data,
    fetchedAt,
  };
}
