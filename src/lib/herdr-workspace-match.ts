import { normalize, resolve } from "path";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { herdrCliJson } from "./herdr-project-cli.ts";

function listWorkspaces(session = "") {
  return herdrCliJson(session, ["workspace", "list"]);
}

function listPanes(session = "") {
  return herdrCliJson(session, ["pane", "list"]);
}

function listAgents(session = "") {
  return herdrCliJson(session, ["agent", "list"]);
}

function normalizeProjectPath(path: string): string {
  if (!path) return "";
  return normalize(resolve(path));
}

function paneMatchesProject(
  pane: { cwd?: string; foreground_cwd?: string },
  projectPath: string
): boolean {
  const cwd = pane.cwd ? normalizeProjectPath(pane.cwd) : "";
  const foreground = pane.foreground_cwd ? normalizeProjectPath(pane.foreground_cwd) : "";
  return cwd === projectPath || foreground === projectPath;
}

export interface WorkspacesForProjectResult {
  workspaceIds: string[];
  errors: string[];
}

export function findAllWorkspacesForProject(
  config: HerdrProjectConfig
): WorkspacesForProjectResult {
  const projectPath = normalizeProjectPath(config.projectPath || "");
  if (!projectPath) return { workspaceIds: [], errors: [] };
  const label = config.workspaceLabel;
  const ids = new Set<string>();
  const errors: string[] = [];

  const workspaces = listWorkspaces(config.session);
  if (workspaces.ok) {
    const rows = (workspaces.json?.result?.workspaces || []) as Array<{
      workspace_id?: string;
      label?: string;
      worktree?: { checkout_path?: string };
    }>;

    // checkout_path matches (all, not just first)
    for (const ws of rows) {
      if (
        ws.workspace_id &&
        ws.worktree?.checkout_path &&
        normalizeProjectPath(ws.worktree.checkout_path) === projectPath
      ) {
        ids.add(ws.workspace_id);
      }
    }

    // label matches
    if (label) {
      const labeled = rows.filter((ws) => ws.label === label && ws.workspace_id);
      if (labeled.length === 1) {
        ids.add(labeled[0]!.workspace_id!);
      } else if (labeled.length > 1) {
        const panes = listPanes(config.session);
        if (panes.ok) {
          const paneRows = (panes.json?.result?.panes || []) as Array<{
            workspace_id?: string;
            cwd?: string;
            foreground_cwd?: string;
          }>;
          for (const ws of labeled) {
            const confirmed = paneRows.some(
              (pane) =>
                pane.workspace_id === ws.workspace_id && paneMatchesProject(pane, projectPath)
            );
            if (confirmed && ws.workspace_id) ids.add(ws.workspace_id);
          }
        }
      }
    }
  } else {
    errors.push(`workspace list: ${workspaces.error}`);
  }

  // cwd matches via panes
  const panes = listPanes(config.session);
  if (panes.ok) {
    const paneRows = (panes.json?.result?.panes || []) as Array<{
      workspace_id?: string;
      cwd?: string;
      foreground_cwd?: string;
    }>;
    for (const pane of paneRows) {
      if (pane.workspace_id && paneMatchesProject(pane, projectPath)) {
        ids.add(pane.workspace_id);
      }
    }
  } else {
    errors.push(`pane list: ${panes.error}`);
  }

  return { workspaceIds: [...ids], errors };
}

export type WorkspacePaneCountFn = (workspaceId: string, session: string) => number;

function defaultWorkspacePaneCount(workspaceId: string, session: string): number {
  const listed = herdrCliJson(session, ["pane", "list", "--workspace", workspaceId]);
  return listed.ok ? ((listed.json?.result?.panes || []) as unknown[]).length : 0;
}

/**
 * When several workspaces match, prefer the one with the most panes in this session.
 * Candidates are sorted lexicographically before comparison so ties are stable across
 * restarts — stable does not imply user intent (equal pane counts may still pick wA
 * over wB only because of id ordering, which can correlate with creation order).
 */
export function pickBestWorkspaceId(
  workspaceIds: string[],
  session = "",
  paneCount: WorkspacePaneCountFn = defaultWorkspacePaneCount
): string {
  if (workspaceIds.length === 0) {
    throw new Error("pickBestWorkspaceId requires at least one workspace id");
  }
  const ordered = [...workspaceIds].sort((a, b) => a.localeCompare(b));
  if (ordered.length === 1) return ordered[0]!;

  let bestId = ordered[0]!;
  let bestCount = -1;
  for (const workspaceId of ordered) {
    const count = paneCount(workspaceId, session);
    if (count > bestCount) {
      bestCount = count;
      bestId = workspaceId;
    }
  }
  return bestId;
}

export type WorkspaceIdResolution =
  | "none"
  | "single"
  | "focused_cwd"
  | "cwd"
  | "pane_count"
  | "lexicographic";

export interface ResolvedPrimaryWorkspace {
  workspaceId: string | null;
  resolution: WorkspaceIdResolution;
  candidateIds: string[];
}

function sortedWorkspaceCandidates(workspaceIds: string[]): string[] {
  return [...workspaceIds].sort((a, b) => a.localeCompare(b));
}

/**
 * Pick the primary workspace for dashboard meta and discovery.
 * Priority: focused+cwd match → cwd match → most panes → lexicographic id.
 * The lexicographic fallback is deterministic but not semantically meaningful — see
 * pickBestWorkspaceId.
 */
export function resolvePrimaryWorkspaceId(config: HerdrProjectConfig): ResolvedPrimaryWorkspace {
  const { workspaceIds } = findAllWorkspacesForProject(config);
  const candidates = sortedWorkspaceCandidates(workspaceIds);
  if (candidates.length === 0) {
    return { workspaceId: null, resolution: "none", candidateIds: [] };
  }
  if (candidates.length === 1) {
    return { workspaceId: candidates[0]!, resolution: "single", candidateIds: candidates };
  }

  const projectPath = normalizeProjectPath(config.projectPath || "");
  const workspaces = listWorkspaces(config.session);
  if (workspaces.ok && projectPath) {
    const rows = (workspaces.json?.result?.workspaces || []) as Array<{
      workspace_id?: string;
      cwd?: string;
      focused?: boolean;
    }>;

    const focusedCwd = rows.find(
      (ws) =>
        ws.workspace_id &&
        candidates.includes(ws.workspace_id) &&
        ws.focused &&
        ws.cwd &&
        normalizeProjectPath(ws.cwd) === projectPath
    );
    if (focusedCwd?.workspace_id) {
      return {
        workspaceId: focusedCwd.workspace_id,
        resolution: "focused_cwd",
        candidateIds: candidates,
      };
    }

    const cwdMatch = rows.find(
      (ws) =>
        ws.workspace_id &&
        candidates.includes(ws.workspace_id) &&
        ws.cwd &&
        normalizeProjectPath(ws.cwd) === projectPath
    );
    if (cwdMatch?.workspace_id) {
      return {
        workspaceId: cwdMatch.workspace_id,
        resolution: "cwd",
        candidateIds: candidates,
      };
    }
  }

  const paneCounts = candidates.map((id) => defaultWorkspacePaneCount(id, config.session));
  const maxCount = Math.max(...paneCounts);
  if (maxCount > 0) {
    return {
      workspaceId: pickBestWorkspaceId(candidates, config.session),
      resolution: "pane_count",
      candidateIds: candidates,
    };
  }

  return {
    workspaceId: candidates[0]!,
    resolution: "lexicographic",
    candidateIds: candidates,
  };
}

export function findWorkspaceForProject(config: HerdrProjectConfig) {
  const { workspaceIds: ids, errors } = findAllWorkspacesForProject(config);
  if (ids.length > 0) {
    const resolved = resolvePrimaryWorkspaceId(config);
    return {
      workspaceId: resolved.workspaceId,
      reason:
        ids.length > 1 ? `${resolved.resolution}:${resolved.workspaceId}` : resolved.workspaceId,
    };
  }
  if (errors.length > 0) {
    return { workspaceId: null as string | null, reason: errors.join("; ") };
  }
  // Preserve original reason strings for backward compatibility
  const projectPath = normalizeProjectPath(config.projectPath || "");
  if (!projectPath) return { workspaceId: null as string | null, reason: "not_found" };

  const panes = listPanes(config.session);
  if (!panes.ok) return { workspaceId: null as string | null, reason: panes.error };
  return { workspaceId: null, reason: "not_found" };
}

/** Resolve a workspace-scoped pane id — never returns a bare agent label. */
export function resolveWorkspaceAgentPaneId(
  config: HerdrProjectConfig,
  agentName: string,
  workspaceId?: string | null
): string | null {
  const listed = listAgents(config.session);
  if (!listed.ok) return null;

  const resolvedWorkspace = workspaceId ?? findWorkspaceForProject(config).workspaceId;
  if (!resolvedWorkspace) return null;

  const rows = (listed.json?.result?.agents || []) as Array<{
    agent?: string;
    pane_id?: string;
    workspace_id?: string;
  }>;

  const matches = rows.filter(
    (row) => row.agent === agentName && row.pane_id && row.workspace_id === resolvedWorkspace
  );
  return matches.length === 1 ? matches[0]!.pane_id! : null;
}
