/**
 * herdr-dashboard-widget-processes.ts — Session-scoped pane list widget.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { buildRemoteHerdrArgs } from "./herdr-project-cli.ts";
import { listPanesSync, type PaneInfo } from "./herdr-pane-service.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
  type ResolvedRemoteHost,
} from "./herdr-orchestrator-config.ts";
import { friendlySshError, sshExec } from "./herdr-orchestrator.ts";
import type { DashboardSessionCatalogEntry } from "./herdr-dashboard-sessions.ts";
import type { DashboardMetaDiscovery } from "./herdr-dashboard-discovery-meta.ts";
import {
  dashboardWidgetSessionLabel,
  resolveDashboardWidgetSession,
} from "./herdr-dashboard-widget-session.ts";

export const PROCESSES_WIDGET_WORKSPACE_SCOPE = "*";

export interface DashboardProcessesPaneRow {
  paneId: string;
  tabId: string;
  workspaceId: string;
  title: string;
  cwd: string;
  agent: string | null;
  agentStatus: string | null;
  focused: boolean;
}

export interface DashboardProcessesWidgetData {
  panes: DashboardProcessesPaneRow[];
  paneCount: number;
}

export interface DashboardProcessesWidgetFetchOptions {
  session?: string;
  catalog?: DashboardMetaDiscovery["sessionCatalog"];
}

export type DashboardProcessesWidgetResponse =
  | {
      ok: true;
      widget: "processes";
      session: string;
      sessionLabel: string;
      available: true;
      data: DashboardProcessesWidgetData;
      fetchedAt: string;
    }
  | {
      ok: false;
      widget: "processes";
      session: string;
      sessionLabel: string;
      available: false;
      error: string;
      fetchedAt: string;
    };

export interface ProcessesWidgetDeps {
  listLocalPanes: (session: string) => ReturnType<typeof listPanesSync>;
  fetchRemotePanes: (
    resolved: ResolvedRemoteHost,
    hostLabel: string,
    session: string
  ) => Promise<{ ok: true; panes: PaneInfo[] } | { ok: false; error: string }>;
}

const defaultDeps: ProcessesWidgetDeps = {
  listLocalPanes: (session) => listPanesSync(undefined, session),
  fetchRemotePanes: fetchRemoteSessionPanes,
};

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function mapPaneInfoToWidgetRow(pane: PaneInfo): DashboardProcessesPaneRow {
  return {
    paneId: pane.paneId,
    tabId: pane.tabId,
    workspaceId: pane.workspaceId,
    title: pane.title,
    cwd: pane.cwd,
    agent: pane.agent,
    agentStatus: pane.agentStatus,
    focused: pane.focused,
  };
}

export function parseHerdrPaneListOutput(
  output: string
): { ok: true; panes: PaneInfo[] } | { ok: false; error: string } {
  try {
    const json = JSON.parse(output) as {
      result?: { panes?: Array<Record<string, unknown>> };
    };
    const raw = json.result?.panes ?? [];
    const panes: PaneInfo[] = raw.map((pane) => ({
      paneId: String(pane.pane_id ?? ""),
      tabId: String(pane.tab_id ?? ""),
      workspaceId: String(pane.workspace_id ?? ""),
      focused: Boolean(pane.focused),
      agent: typeof pane.agent === "string" ? pane.agent : null,
      agentStatus: typeof pane.agent_status === "string" ? pane.agent_status : null,
      title: String(pane.title ?? ""),
      cwd: String(pane.cwd ?? ""),
      isShell: !pane.agent || String(pane.agent).length === 0,
    }));
    return { ok: true, panes };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid pane list JSON: ${message}` };
  }
}

async function fetchRemoteSessionPanes(
  resolved: ResolvedRemoteHost,
  hostLabel: string,
  session: string
): Promise<{ ok: true; panes: PaneInfo[] } | { ok: false; error: string }> {
  const result = await sshExec(resolved, buildRemoteHerdrArgs(session, ["pane", "list"]));
  if (!result.ok) {
    return { ok: false, error: friendlySshError(result.output, hostLabel) };
  }
  const parsed = parseHerdrPaneListOutput(result.output);
  if (!parsed.ok) return parsed;
  return { ok: true, panes: parsed.panes };
}

function unavailableResponse(
  session: string,
  error: string,
  fetchedAt: string
): DashboardProcessesWidgetResponse {
  return {
    ok: false,
    widget: "processes",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    available: false,
    error,
    fetchedAt,
  };
}

async function collectSessionPanes(
  entry: DashboardSessionCatalogEntry,
  projectPath: string,
  deps: ProcessesWidgetDeps
): Promise<{ ok: true; panes: PaneInfo[] } | { ok: false; error: string }> {
  if (entry.host === "(local)") {
    const listed = deps.listLocalPanes(entry.session);
    if (!listed.ok) return { ok: false, error: listed.error };
    return { ok: true, panes: listed.panes };
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
  return deps.fetchRemotePanes(resolved, entry.host, entry.session);
}

/** Fetch pane list for one Herdr session (all workspaces — cache scope `*`). */
export async function fetchDashboardProcessesWidget(
  projectPath: string,
  options: DashboardProcessesWidgetFetchOptions = {},
  deps: Partial<ProcessesWidgetDeps> = {}
): Promise<DashboardProcessesWidgetResponse> {
  const merged = { ...defaultDeps, ...deps };
  const fetchedAt = new Date().toISOString();
  const session = options.session?.trim() ?? "";

  const resolved = resolveDashboardWidgetSession(session, options.catalog);
  if (!resolved.ok) {
    return unavailableResponse(session, resolved.error, fetchedAt);
  }

  const collected = await collectSessionPanes(resolved.entry, projectPath, merged);
  if (!collected.ok) {
    return unavailableResponse(session, collected.error, fetchedAt);
  }

  const panes = collected.panes.map(mapPaneInfoToWidgetRow);
  return {
    ok: true,
    widget: "processes",
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    available: true,
    data: { panes, paneCount: panes.length },
    fetchedAt,
  };
}
