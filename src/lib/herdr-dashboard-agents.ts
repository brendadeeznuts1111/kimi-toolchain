/**
 * herdr-dashboard-agents.ts — In-process agent discovery for the orchestrator dashboard.
 *
 * Single-sourced with `herdr-orchestrator dashboard --json`; avoids subprocess spawn per poll.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import {
  discoverRemoteSessions,
  discoverRemoteWorkspaceAgents,
  listWorkspaceAgents,
} from "./herdr-orchestrator.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
} from "./herdr-orchestrator-config.ts";
import { findAllWorkspacesForProject } from "./herdr-workspace-match.ts";
import { herdrCliJson } from "./herdr-project-cli.ts";
import type {
  DashboardAgentRow,
  DashboardAgentsPayload,
  DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";

export interface GetDashboardAgentsOptions extends DashboardFetchOptions {
  workspace?: string;
}

/** Collect dashboard agent rows without spawning herdr-orchestrator. */
export async function getDashboardAgents(
  projectPath: string,
  options: GetDashboardAgentsOptions = {}
): Promise<DashboardAgentsPayload> {
  const fetchedAt = new Date().toISOString();
  const config = discoverHerdrProjectConfig(projectPath);
  if (!config?.enabled) {
    return {
      ok: false,
      projectPath,
      agentCount: 0,
      agents: [],
      error: "no [herdr] profile",
      fetchedAt,
    };
  }

  const full = { ...config, projectPath };
  const discovered = findAllWorkspacesForProject(full);
  const ids = options.workspace ? [options.workspace] : discovered.workspaceIds;
  const session = config.session;
  const cliErrors: string[] = [...discovered.errors];
  const rows: DashboardAgentRow[] = [];

  const hostFilter = options.host?.trim() || undefined;
  const showSessions = options.sessions === true;
  const domain = options.domain?.trim() || undefined;
  const includeDoctor = options.includeDoctor === true;

  if (showSessions) {
    if (!hostFilter) {
      const sessionsRaw = herdrCliJson("", ["session", "list"]);
      const sessionList = sessionsRaw.ok
        ? (sessionsRaw.json as { sessions?: Array<{ name: string; running: boolean }> })
            ?.sessions || []
        : [];
      for (const s of sessionList) {
        if (!s.running) continue;
        const wsRaw = herdrCliJson(s.name, ["workspace", "list"]);
        const workspaces = wsRaw.ok
          ? (wsRaw.json as { result?: { workspaces?: Array<{ workspace_id: string }> } })?.result
              ?.workspaces || []
          : [];
        for (const ws of workspaces) {
          const listed = listWorkspaceAgents(ws.workspace_id!, s.name);
          if (!listed.ok) {
            if (listed.error) cliErrors.push(listed.error);
            continue;
          }
          for (const a of listed.agents) {
            rows.push({
              host: "(local)",
              session: s.name,
              workspaceId: ws.workspace_id!,
              agent: a.agent,
              status: a.status,
              paneId: a.paneId,
              source: "",
            });
          }
        }
      }
    }

    const doc = (() => {
      if (!config.sourcePath) return null;
      try {
        return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
      } catch {
        return null;
      }
    })();
    const orchConfig = resolveOrchestratorConfig(full, doc);
    const remoteHosts = orchConfig.remoteHosts;
    const domainMembers = domain ? new Set(orchConfig.domains[domain]?.hosts || []) : null;

    const hostsToScan = hostFilter
      ? Object.fromEntries(Object.entries(remoteHosts).filter(([k]) => k === hostFilter))
      : domain
        ? Object.fromEntries(Object.entries(remoteHosts).filter(([k]) => domainMembers?.has(k)))
        : remoteHosts;

    if (Object.keys(hostsToScan).length > 0) {
      const resolvedHosts = normalizeRemoteHostConfig(hostsToScan, orchConfig.remoteDefaults);
      const remoteDiscovered = await discoverRemoteSessions(hostsToScan, orchConfig.remoteDefaults);
      for (const rs of remoteDiscovered.sessions) {
        if (rs.status !== "running") continue;
        const resolved = resolvedHosts[rs.host];
        if (!resolved) continue;
        const remoteAgents = await discoverRemoteWorkspaceAgents(rs.host, resolved, rs.sessionName);
        for (const ra of remoteAgents) {
          rows.push({
            host: ra.host,
            session: ra.sessionName,
            workspaceId: ra.workspaceId,
            agent: ra.agent,
            status: ra.status,
            paneId: ra.paneId,
            source: "",
          });
        }
      }
    } else if (hostFilter) {
      return {
        ok: false,
        projectPath,
        agentCount: 0,
        agents: [],
        error: `host "${hostFilter}" not configured`,
        fetchedAt,
      };
    }
  } else if (!hostFilter || hostFilter === "local") {
    for (const id of ids) {
      const listed = listWorkspaceAgents(id, session);
      if (!listed.ok) {
        if (listed.error) cliErrors.push(listed.error);
        continue;
      }
      for (const a of listed.agents) {
        rows.push({
          host: "(local)",
          session: "",
          workspaceId: id,
          agent: a.agent,
          status: a.status,
          paneId: a.paneId,
          source: "",
        });
      }
    }
  }

  const rawAgents = herdrCliJson(session, ["agent", "list"]);
  const agentSessionMap = new Map<string, string>();
  if (rawAgents.ok) {
    const rawRows = (rawAgents.json?.result?.agents || []) as Array<{
      agent?: string;
      pane_id?: string;
      agent_session?: { source?: string };
    }>;
    for (const r of rawRows) {
      if (r.pane_id && r.agent_session?.source) {
        agentSessionMap.set(r.pane_id, r.agent_session.source);
      }
    }
  }
  for (const row of rows) {
    row.source = agentSessionMap.get(row.paneId) || (row.agent ? "reported" : "detected");
  }

  if (includeDoctor) {
    const doctorResult = herdrCliJson("", ["server", "agent-manifests"]);
    if (doctorResult.ok) {
      const manifests =
        (
          doctorResult.json as {
            manifests?: Array<{ name?: string; source?: string; state?: string }>;
          }
        )?.manifests || [];
      const existingNames = new Set(rows.map((r) => r.agent));
      for (const m of manifests) {
        if (m.name && m.source?.startsWith("herdr:") && !existingNames.has(m.name)) {
          rows.push({
            host: "(local)",
            session: session || "",
            workspaceId: "doctor",
            agent: m.name,
            status: "unknown",
            paneId: "manifest",
            source: m.source || "",
          });
        }
      }
    }
  }

  const error = cliErrors.length > 0 ? cliErrors.join("; ") : undefined;
  const ok = cliErrors.length === 0 || rows.length > 0;
  return {
    ok,
    projectPath,
    agentCount: rows.length,
    agents: rows,
    ...(error ? { error } : {}),
    fetchedAt,
  };
}
