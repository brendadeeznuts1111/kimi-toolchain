import { normalize, resolve } from "node:path";
import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { execCliJson } from "./herdr-project-cli.ts";

function herdrArgs(session: string) {
  return session ? ["--session", session] : [];
}

function listWorkspaces(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "workspace", "list"]);
}

function listPanes(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "pane", "list"]);
}

function listAgents(session = "") {
  return execCliJson("herdr", [...herdrArgs(session), "agent", "list"]);
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

export function findWorkspaceForProject(config: HerdrProjectConfig) {
  const projectPath = normalizeProjectPath(config.projectPath || "");
  if (!projectPath) return { workspaceId: null as string | null, reason: "not_found" };
  const label = config.workspaceLabel;

  const workspaces = listWorkspaces(config.session);
  if (workspaces.ok) {
    const rows = (workspaces.json?.result?.workspaces || []) as Array<{
      workspace_id?: string;
      label?: string;
      worktree?: { checkout_path?: string };
    }>;

    const byCheckout = rows.find(
      (ws) =>
        ws.worktree?.checkout_path &&
        normalizeProjectPath(ws.worktree.checkout_path) === projectPath
    );
    if (byCheckout?.workspace_id) {
      return { workspaceId: byCheckout.workspace_id, reason: "checkout_path" };
    }

    if (label) {
      const labeled = rows.filter((ws) => ws.label === label);
      if (labeled.length === 1 && labeled[0]?.workspace_id) {
        return { workspaceId: labeled[0].workspace_id, reason: "label" };
      }
      if (labeled.length > 1) {
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
            if (confirmed && ws.workspace_id) {
              return { workspaceId: ws.workspace_id, reason: "label+cwd" };
            }
          }
        }
      }
    }
  }

  const panes = listPanes(config.session);
  if (!panes.ok) return { workspaceId: null as string | null, reason: panes.error };
  const paneRows = (panes.json?.result?.panes || []) as Array<{
    workspace_id?: string;
    cwd?: string;
    foreground_cwd?: string;
  }>;
  const byCwd = paneRows.find((pane) => paneMatchesProject(pane, projectPath));
  if (byCwd?.workspace_id) return { workspaceId: byCwd.workspace_id, reason: "cwd" };
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
