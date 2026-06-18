/**
 * herdr-dashboard-agents.ts — In-process agent discovery for the orchestrator dashboard.
 *
 * Single-sourced with `herdr-orchestrator dashboard --json`; avoids subprocess spawn per poll.
 */

import { TOML } from "bun";
import { readText } from "./bun-io.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { discoverRemoteWorkspaceAgents, listWorkspaceAgents } from "./herdr-orchestrator.ts";
import {
  normalizeRemoteHostConfig,
  resolveOrchestratorConfig,
} from "./herdr-orchestrator-config.ts";
import { findAllWorkspacesForProject } from "./herdr-workspace-match.ts";
import { herdrCliJson } from "./herdr-project-cli.ts";
import {
  discoverAllSessions,
  withDashboardSessionTimeout,
  type DashboardSessionCatalogEntry,
} from "./herdr-dashboard-sessions.ts";
import type {
  DashboardAgentRow,
  DashboardAgentsPayload,
  DashboardFetchOptions,
} from "./herdr-dashboard-data.ts";

export interface GetDashboardAgentsOptions extends DashboardFetchOptions {
  workspace?: string;
}

function loadOrchestratorDocument(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function collectLocalSessionAgents(
  entry: DashboardSessionCatalogEntry,
  workspaceIds: string[]
): Promise<{ rows: DashboardAgentRow[]; errors: string[] }> {
  const rows: DashboardAgentRow[] = [];
  const errors: string[] = [];
  const session = entry.session;

  if (session.trim()) {
    const wsRaw = herdrCliJson(session, ["workspace", "list"]);
    const workspaces = wsRaw.ok
      ? (wsRaw.json as { result?: { workspaces?: Array<{ workspace_id: string }> } })?.result
          ?.workspaces || []
      : [];
    if (!wsRaw.ok && wsRaw.error) errors.push(wsRaw.error);
    for (const ws of workspaces) {
      const listed = listWorkspaceAgents(ws.workspace_id!, session);
      if (!listed.ok) {
        if (listed.error) errors.push(listed.error);
        continue;
      }
      for (const a of listed.agents) {
        rows.push({
          host: "(local)",
          session,
          workspaceId: ws.workspace_id!,
          agent: a.agent,
          status: a.status,
          paneId: a.paneId,
          source: "",
        });
      }
    }
    return { rows, errors };
  }

  for (const id of workspaceIds) {
    const listed = listWorkspaceAgents(id, "");
    if (!listed.ok) {
      if (listed.error) errors.push(listed.error);
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
  return { rows, errors };
}

async function collectRemoteSessionAgents(
  entry: DashboardSessionCatalogEntry,
  resolvedHosts: ReturnType<typeof normalizeRemoteHostConfig>
): Promise<{ rows: DashboardAgentRow[]; errors: string[] }> {
  const resolved = resolvedHosts[entry.host];
  if (!resolved) {
    return { rows: [], errors: [`remote host "${entry.host}" not configured`] };
  }
  const remoteAgents = await discoverRemoteWorkspaceAgents(entry.host, resolved, entry.session);
  return {
    rows: remoteAgents.map((ra) => ({
      host: ra.host,
      session: ra.sessionName,
      workspaceId: ra.workspaceId,
      agent: ra.agent,
      status: ra.status,
      paneId: ra.paneId,
      source: "",
    })),
    errors: [],
  };
}

async function collectSessionAgentRows(
  entry: DashboardSessionCatalogEntry,
  workspaceIds: string[],
  resolvedHosts: ReturnType<typeof normalizeRemoteHostConfig>
): Promise<{ rows: DashboardAgentRow[]; errors: string[] }> {
  if (entry.host === "(local)") {
    return collectLocalSessionAgents(entry, workspaceIds);
  }
  return collectRemoteSessionAgents(entry, resolvedHosts);
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
  const includeDoctor = options.includeDoctor === true;

  if (showSessions) {
    const catalog = options.sessionCatalog ?? (await discoverAllSessions(projectPath, options));
    cliErrors.push(...catalog.errors);

    const doc = loadOrchestratorDocument(config.sourcePath ?? null);
    const orchConfig = resolveOrchestratorConfig(full, doc);
    const resolvedHosts = normalizeRemoteHostConfig(
      orchConfig.remoteHosts,
      orchConfig.remoteDefaults
    );

    let targets = catalog.entries.filter((entry) => entry.reachable);
    if (hostFilter) {
      targets = targets.filter(
        (entry) => entry.host === hostFilter || (hostFilter === "local" && entry.host === "(local)")
      );
      if (targets.length === 0 && hostFilter !== "local") {
        return {
          ok: false,
          projectPath,
          agentCount: 0,
          agents: [],
          error: `host "${hostFilter}" not configured`,
          fetchedAt,
        };
      }
    }

    const settled = await Promise.allSettled(
      targets.map(async (entry) => {
        const timed = await withDashboardSessionTimeout(
          `session:${entry.label}@${entry.host}`,
          () => collectSessionAgentRows(entry, ids, resolvedHosts)
        );
        if (!timed.ok) {
          return { rows: [] as DashboardAgentRow[], errors: [timed.error] };
        }
        return timed.value;
      })
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        rows.push(...result.value.rows);
        cliErrors.push(...result.value.errors);
      } else {
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        cliErrors.push(message);
      }
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
