/**
 * herdr-dashboard-widget-logs.ts — Pane scrollback widget (`herdr pane read`).
 */

import { TOML } from "bun";
import { readText } from "../../bun-io.ts";
import { discoverHerdrProjectConfig } from "../../herdr-project-config.ts";
import { buildRemoteHerdrArgs, herdrCliRun } from "../../herdr-project-cli.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
  type ResolvedRemoteHost,
} from "../../herdr-orchestrator-config.ts";
import { friendlySshError, sshExec } from "../../herdr-orchestrator.ts";
import type { DashboardSessionCatalogEntry } from "../sessions.ts";
import type { DashboardMetaDiscovery } from "../discovery/meta.ts";
import { dashboardWidgetSessionLabel, resolveDashboardWidgetSession } from "./session.ts";
import { buildLogPreviewLines, type LogPreviewLine } from "../../log-preview.ts";

export const LOGS_WIDGET_DEFAULT_LINES = 50;
export const LOGS_WIDGET_MAX_LINES = 200;
export const LOGS_WIDGET_READ_TIMEOUT_MS = 10_000;

export interface DashboardLogsWidgetFetchOptions {
  session?: string;
  paneId?: string;
  lines?: number;
  /** Line-count offset for incremental tail (poll-based v2). */
  since?: number;
  catalog?: DashboardMetaDiscovery["sessionCatalog"];
}

export type DashboardLogsWidgetResponse =
  | {
      ok: true;
      widget: "logs";
      session: string;
      sessionLabel: string;
      paneId: string;
      available: true;
      lines: string[];
      lineEntries: LogPreviewLine[];
      lineCount: number;
      totalLines: number;
      hasMore: boolean;
      requestedLines: number;
      sinceApplied: number;
      paneRestarted: boolean;
      fetchedAt: string;
    }
  | {
      ok: false;
      widget: "logs";
      session: string;
      sessionLabel: string;
      paneId: string;
      available: false;
      error: string;
      fetchedAt: string;
    };

export interface LogsWidgetDeps {
  readLocalPane: (
    paneId: string,
    session: string,
    lines: number
  ) => { ok: true; text: string } | { ok: false; error: string };
  readRemotePane: (
    resolved: ResolvedRemoteHost,
    hostLabel: string,
    session: string,
    paneId: string,
    lines: number
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}

const defaultDeps: LogsWidgetDeps = {
  readLocalPane: readLocalPaneOutput,
  readRemotePane: readRemotePaneOutput,
};

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clampLogsWidgetLines(lines: number | undefined): number {
  const raw =
    typeof lines === "number" && Number.isFinite(lines)
      ? Math.floor(lines)
      : LOGS_WIDGET_DEFAULT_LINES;
  return Math.min(LOGS_WIDGET_MAX_LINES, Math.max(1, raw));
}

export function splitPaneLogText(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function parseLogsSinceOffset(since: number | undefined): number | undefined {
  if (since === undefined || !Number.isFinite(since)) return undefined;
  return Math.max(0, Math.floor(since));
}

export function logsWidgetHasMore(totalLines: number, requestedLines: number): boolean {
  return totalLines >= requestedLines && requestedLines < LOGS_WIDGET_MAX_LINES;
}

/** Slice scrollback for tail polling (`since` = prior totalLines). */
export function applyLogsSinceOffset(
  allLines: string[],
  since: number | undefined,
  requestedLines: number
): {
  lines: string[];
  totalLines: number;
  hasMore: boolean;
  paneRestarted: boolean;
  sinceApplied: number;
} {
  const totalLines = allLines.length;
  const sinceOffset = parseLogsSinceOffset(since);

  if (sinceOffset === undefined) {
    return {
      lines: allLines,
      totalLines,
      hasMore: logsWidgetHasMore(totalLines, requestedLines),
      paneRestarted: false,
      sinceApplied: 0,
    };
  }

  if (totalLines < sinceOffset) {
    return {
      lines: allLines,
      totalLines,
      hasMore: logsWidgetHasMore(totalLines, requestedLines),
      paneRestarted: true,
      sinceApplied: 0,
    };
  }

  if (sinceOffset >= totalLines) {
    return {
      lines: [],
      totalLines,
      hasMore: logsWidgetHasMore(totalLines, requestedLines),
      paneRestarted: false,
      sinceApplied: sinceOffset,
    };
  }

  return {
    lines: allLines.slice(sinceOffset),
    totalLines,
    hasMore: logsWidgetHasMore(totalLines, requestedLines),
    paneRestarted: false,
    sinceApplied: sinceOffset,
  };
}

function readLocalPaneOutput(
  paneId: string,
  session: string,
  lines: number
): { ok: true; text: string } | { ok: false; error: string } {
  const result = herdrCliRun(
    session,
    ["pane", "read", paneId, "--source", "recent", "--lines", String(lines)],
    LOGS_WIDGET_READ_TIMEOUT_MS
  );
  if (!result.ok) return { ok: false, error: result.output || "pane read failed" };
  return { ok: true, text: result.output };
}

async function readRemotePaneOutput(
  resolved: ResolvedRemoteHost,
  hostLabel: string,
  session: string,
  paneId: string,
  lines: number
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const result = await sshExec(
    resolved,
    buildRemoteHerdrArgs(session, [
      "pane",
      "read",
      paneId,
      "--source",
      "recent",
      "--lines",
      String(lines),
    ])
  );
  if (!result.ok) return { ok: false, error: friendlySshError(result.output, hostLabel) };
  return { ok: true, text: result.output };
}

function unavailableResponse(
  session: string,
  paneId: string,
  error: string,
  fetchedAt: string
): DashboardLogsWidgetResponse {
  return {
    ok: false,
    widget: "logs",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    paneId,
    available: false,
    error,
    fetchedAt,
  };
}

async function collectPaneLogText(
  entry: DashboardSessionCatalogEntry,
  projectPath: string,
  paneId: string,
  lines: number,
  deps: LogsWidgetDeps
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (entry.host === "(local)") {
    return deps.readLocalPane(paneId, entry.session, lines);
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
  return deps.readRemotePane(resolved, entry.host, entry.session, paneId, lines);
}

/** Fetch recent pane output — no cache (volatile scrollback). */
export async function fetchDashboardLogsWidget(
  projectPath: string,
  options: DashboardLogsWidgetFetchOptions = {},
  deps: Partial<LogsWidgetDeps> = {}
): Promise<DashboardLogsWidgetResponse> {
  const merged = { ...defaultDeps, ...deps };
  const fetchedAt = new Date().toISOString();
  const session = options.session?.trim() ?? "";
  const paneId = options.paneId?.trim() ?? "";
  const requestedLines = clampLogsWidgetLines(options.lines);

  if (!paneId) {
    return unavailableResponse(session, "", "paneId required", fetchedAt);
  }

  const resolved = resolveDashboardWidgetSession(session, options.catalog);
  if (!resolved.ok) {
    return unavailableResponse(session, paneId, resolved.error, fetchedAt);
  }

  const collected = await collectPaneLogText(
    resolved.entry,
    projectPath,
    paneId,
    requestedLines,
    merged
  );
  if (!collected.ok) {
    return unavailableResponse(session, paneId, collected.error, fetchedAt);
  }

  const allLines = splitPaneLogText(collected.text);
  const sliced = applyLogsSinceOffset(allLines, options.since, requestedLines);
  return {
    ok: true,
    widget: "logs",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    paneId,
    available: true,
    lines: sliced.lines,
    lineEntries: buildLogPreviewLines(sliced.lines),
    lineCount: sliced.lines.length,
    totalLines: sliced.totalLines,
    hasMore: sliced.hasMore,
    requestedLines,
    sinceApplied: sliced.sinceApplied,
    paneRestarted: sliced.paneRestarted,
    fetchedAt,
  };
}
