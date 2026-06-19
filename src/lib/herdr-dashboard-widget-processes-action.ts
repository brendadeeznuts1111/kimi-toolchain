/**
 * herdr-dashboard-widget-processes-action.ts — Pane focus/zoom/close actions.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { buildRemoteHerdrArgs, herdrCliRun } from "./herdr-project-cli.ts";
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

export const PANE_ACTION_IDS = ["kill", "focus", "zoom"] as const;
export type PaneActionId = (typeof PANE_ACTION_IDS)[number];
export const PANE_ACTION_TIMEOUT_MS = 10_000;

export interface DashboardPaneActionRequest {
  paneId?: string;
  session?: string;
  action?: PaneActionId | string;
  catalog?: DashboardMetaDiscovery["sessionCatalog"];
}

export type DashboardPaneActionResponse =
  | {
      ok: true;
      action: PaneActionId;
      paneId: string;
      session: string;
      sessionLabel: string;
      message: string;
      fetchedAt: string;
    }
  | {
      ok: false;
      action: PaneActionId | string;
      paneId: string;
      session: string;
      sessionLabel: string;
      error: string;
      fetchedAt: string;
    };

export interface ProcessesActionDeps {
  runLocalPaneAction: (
    session: string,
    paneId: string,
    action: PaneActionId
  ) => { ok: true } | { ok: false; error: string };
  runRemotePaneAction: (
    resolved: ResolvedRemoteHost,
    hostLabel: string,
    session: string,
    paneId: string,
    action: PaneActionId
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const defaultDeps: ProcessesActionDeps = {
  runLocalPaneAction: runLocalPaneActionCommand,
  runRemotePaneAction: runRemotePaneActionCommand,
};

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isPaneActionId(value: string): value is PaneActionId {
  return (PANE_ACTION_IDS as readonly string[]).includes(value);
}

/** Map dashboard action → herdr CLI argv (after `herdr [--session S]`). */
export function buildPaneActionHerdrArgs(action: PaneActionId, paneId: string): string[] {
  if (action === "kill") {
    // Herdr uses `pane close` — dashboard exposes this as kill for hung agents.
    return ["pane", "close", paneId];
  }
  if (action === "zoom") {
    return ["pane", "zoom", paneId, "--toggle"];
  }
  // Herdr 0.7+ dropped positional `pane focus <id>`; zoom on→off focuses without staying zoomed.
  return ["pane", "zoom", paneId, "--on"];
}

/** Command steps for an action (focus runs zoom on then off). */
export function paneActionCommandSteps(action: PaneActionId, paneId: string): string[][] {
  if (action === "focus") {
    return [
      ["pane", "zoom", paneId, "--on"],
      ["pane", "zoom", paneId, "--off"],
    ];
  }
  return [buildPaneActionHerdrArgs(action, paneId)];
}

export function paneActionSuccessMessage(action: PaneActionId, paneId: string): string {
  if (action === "kill") return `closed pane ${paneId}`;
  if (action === "focus") return `focused pane ${paneId}`;
  return `zoomed pane ${paneId}`;
}

function runLocalPaneActionCommand(
  session: string,
  paneId: string,
  action: PaneActionId
): { ok: true } | { ok: false; error: string } {
  for (const args of paneActionCommandSteps(action, paneId)) {
    const result = herdrCliRun(session, args, PANE_ACTION_TIMEOUT_MS);
    if (!result.ok) return { ok: false, error: result.output || `${action} failed` };
  }
  return { ok: true };
}

async function runRemotePaneActionCommand(
  resolved: ResolvedRemoteHost,
  hostLabel: string,
  session: string,
  paneId: string,
  action: PaneActionId
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const args of paneActionCommandSteps(action, paneId)) {
    const result = await sshExec(resolved, buildRemoteHerdrArgs(session, args));
    if (!result.ok) return { ok: false, error: friendlySshError(result.output, hostLabel) };
  }
  return { ok: true };
}

function failureResponse(
  action: PaneActionId | string,
  session: string,
  paneId: string,
  error: string,
  fetchedAt: string
): DashboardPaneActionResponse {
  return {
    ok: false,
    action,
    paneId,
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    error,
    fetchedAt,
  };
}

async function dispatchPaneAction(
  entry: DashboardSessionCatalogEntry,
  projectPath: string,
  paneId: string,
  action: PaneActionId,
  deps: ProcessesActionDeps
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (entry.host === "(local)") {
    return deps.runLocalPaneAction(entry.session, paneId, action);
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
  return deps.runRemotePaneAction(resolved, entry.host, entry.session, paneId, action);
}

/** Run a pane action for one Herdr session (local or SSH remote). */
export async function runDashboardPaneAction(
  projectPath: string,
  request: DashboardPaneActionRequest = {},
  deps: Partial<ProcessesActionDeps> = {}
): Promise<DashboardPaneActionResponse> {
  const merged = { ...defaultDeps, ...deps };
  const fetchedAt = new Date().toISOString();
  const session = request.session?.trim() ?? "";
  const paneId = request.paneId?.trim() ?? "";
  const actionRaw = request.action?.trim() ?? "";

  if (!paneId) {
    return failureResponse(actionRaw || "unknown", session, "", "paneId required", fetchedAt);
  }
  if (!isPaneActionId(actionRaw)) {
    return failureResponse(
      actionRaw || "unknown",
      session,
      paneId,
      `unknown action "${actionRaw}"`,
      fetchedAt
    );
  }

  const resolved = resolveDashboardWidgetSession(session, request.catalog);
  if (!resolved.ok) {
    return failureResponse(actionRaw, session, paneId, resolved.error, fetchedAt);
  }

  const outcome = await dispatchPaneAction(resolved.entry, projectPath, paneId, actionRaw, merged);
  if (!outcome.ok) {
    return failureResponse(actionRaw, session, paneId, outcome.error, fetchedAt);
  }

  return {
    ok: true,
    action: actionRaw,
    paneId,
    session,
    sessionLabel: dashboardWidgetSessionLabel(session),
    message: paneActionSuccessMessage(actionRaw, paneId),
    fetchedAt,
  };
}
