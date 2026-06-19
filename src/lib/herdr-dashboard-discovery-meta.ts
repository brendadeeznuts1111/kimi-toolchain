/**
 * herdr-dashboard-discovery-meta.ts — Session/workspace discovery context for GET /api/meta.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { resolvePrimaryWorkspaceId, type WorkspaceIdResolution } from "./herdr-workspace-match.ts";
import type { DashboardFetchOptions } from "./herdr-dashboard-data.ts";
import type { DashboardRemoteHostsStatus } from "./herdr-remote-host-probe.ts";
import {
  buildEmptySessionCatalog,
  buildSingleSessionCatalog,
  type DashboardSessionCatalog,
} from "./herdr-dashboard-sessions.ts";

export type DashboardDiscoveryMode = "workspace" | "sessions";

export interface DashboardRemoteHostsMeta {
  configured: number;
  reachable: number;
  hosts: Array<{
    label: string;
    reachable: boolean;
    version?: string;
    error?: string;
  }>;
}

export interface DashboardSessionMeta {
  session: string;
  label: string;
  host: string;
  reachable: boolean;
  error?: string;
}

export interface DashboardMetaDiscovery {
  herdrSession: string;
  herdrSessionLabel: string;
  mode: DashboardDiscoveryMode;
  workspaceLabel: string | null;
  workspaceId: string | null;
  /** How workspaceId was chosen when multiple candidates matched. */
  workspaceIdResolution: WorkspaceIdResolution;
  /** Candidates scanned for workspaceId (0 = scan miss/disabled, 1 = unambiguous single). */
  workspaceCandidateCount: number;
  /** @deprecated Use `remoteHosts.configured` — removed in Phase 3. */
  remoteHostsConfigured: number;
  /** Live reachability from SSH `herdr version` probe (refreshed with discovery). */
  remoteHosts: DashboardRemoteHostsMeta;
  /**
   * True when dashboard scans all Herdr sessions (`--sessions` CLI flag).
   * Not inferred from IPC subscribers or named-session config alone — may widen later.
   */
  multiSessionEnabled: boolean;
  /** Herdr session ids for selector (`""` = primary). Populated from enumeration when `--sessions`. */
  sessionsAvailable: string[];
  /** Per-session reachability when multi-session scan is enabled. */
  sessionCatalog: DashboardSessionMeta[];
}

export interface BuildDashboardMetaDiscoveryOptions {
  /** Resolve workspace id by shelling out to Herdr. Disable for startup-fast snapshots. */
  resolveWorkspace?: boolean;
}

function resolveRemoteHostsMeta(
  configuredFromConfig: number,
  status?: DashboardRemoteHostsStatus
): DashboardRemoteHostsMeta {
  if (status) {
    return {
      configured: status.configured,
      reachable: status.reachable,
      hosts: status.hosts.map((host) => ({
        label: host.label,
        reachable: host.reachable,
        ...(host.version ? { version: host.version } : {}),
        ...(host.error ? { error: host.error } : {}),
      })),
    };
  }
  return {
    configured: configuredFromConfig,
    reachable: 0,
    hosts: [],
  };
}

function herdrSessionLabel(session: string): string {
  const trimmed = session.trim();
  return trimmed.length > 0 ? trimmed : "primary";
}

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveSessionMeta(catalog: DashboardSessionCatalog): {
  sessionsAvailable: string[];
  sessionCatalog: DashboardSessionMeta[];
} {
  return {
    sessionsAvailable: catalog.sessionsAvailable,
    sessionCatalog: catalog.entries.map((entry) => ({
      session: entry.session,
      label: entry.label,
      host: entry.host,
      reachable: entry.reachable,
      ...(entry.error ? { error: entry.error } : {}),
    })),
  };
}

/** Resolve discovery context from dx.config.toml [herdr] and dashboard fetch flags. */
export function buildDashboardMetaDiscovery(
  projectPath: string,
  options: Pick<DashboardFetchOptions, "sessions"> = {},
  remoteHostsStatus?: DashboardRemoteHostsStatus,
  sessionCatalog?: DashboardSessionCatalog,
  buildOptions: BuildDashboardMetaDiscoveryOptions = {}
): DashboardMetaDiscovery {
  const config = discoverHerdrProjectConfig(projectPath);
  const session = config?.session ?? "";
  const resolveWorkspace = buildOptions.resolveWorkspace !== false;
  // Coupled to DashboardFetchOptions.sessions today; not sessionCount or bus subscribers.
  const multiSessionEnabled = options.sessions === true;

  let workspaceId: string | null = null;
  let workspaceIdResolution: WorkspaceIdResolution = "none";
  let workspaceCandidateCount = 0;
  if (config?.enabled && resolveWorkspace) {
    const resolved = resolvePrimaryWorkspaceId({ ...config, projectPath });
    workspaceId = resolved.workspaceId;
    workspaceIdResolution = resolved.resolution;
    workspaceCandidateCount = resolved.candidateIds.length;
  }

  const doc = loadOrchestratorDocument(config?.sourcePath ?? null);
  const orchConfig =
    config?.enabled === true ? resolveOrchestratorConfig({ ...config, projectPath }, doc) : null;
  const remoteHostsConfigured = orchConfig ? Object.keys(orchConfig.remoteHosts).length : 0;
  const remoteHosts = resolveRemoteHostsMeta(remoteHostsConfigured, remoteHostsStatus);
  const catalog =
    sessionCatalog ??
    (multiSessionEnabled ? buildEmptySessionCatalog() : buildSingleSessionCatalog(session));
  const sessionMeta = resolveSessionMeta(catalog);

  return {
    herdrSession: session,
    herdrSessionLabel: herdrSessionLabel(session),
    mode: multiSessionEnabled ? "sessions" : "workspace",
    workspaceLabel: config?.workspaceLabel ?? null,
    workspaceId,
    workspaceIdResolution,
    workspaceCandidateCount,
    remoteHostsConfigured: remoteHosts.configured,
    remoteHosts,
    multiSessionEnabled,
    sessionsAvailable: sessionMeta.sessionsAvailable,
    sessionCatalog: sessionMeta.sessionCatalog,
  };
}
