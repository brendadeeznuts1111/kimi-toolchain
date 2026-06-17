/**
 * herdr-workspace-service.ts — Effect-based herdr workspace operations
 *
 * Wraps the `herdr workspace` CLI family in typed Effect services using
 * Bun.spawn / Bun.spawnSync. Mirrors herdr-pane-service.ts patterns.
 */

import { Effect, pipe } from "effect";
import {
  herdrCli,
  herdrCliJsonSync,
  herdrCliSync,
  herdrCliError,
  type HerdrCliError,
} from "./herdr-cli.ts";
import { ensureJsonArgs } from "./herdr-project-cli.ts";

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  workspaceId: string;
  label: string;
  cwd: string;
  focused: boolean;
  tabCount: number;
  paneCount: number;
}

export interface WorkspaceCreateResult {
  workspaceId: string;
  tabId: string;
  rootPaneId: string;
}

// ── CLI invocation ──────────────────────────────────────────────────────

/** Async herdr CLI → JSON. */
function herdrCliJson<T>(args: string[], session?: string): Effect.Effect<T, HerdrCliError> {
  return pipe(
    herdrCli(ensureJsonArgs(args), session),
    Effect.flatMap((stdout) => {
      try {
        return Effect.succeed(JSON.parse(stdout) as T);
      } catch {
        return Effect.fail(
          herdrCliError(`invalid JSON: ${stdout.slice(0, 200)}`, null, args[0] || "cli")
        );
      }
    })
  );
}

// ── Effect-based operations ─────────────────────────────────────────────

/** List all workspaces in the current session. */
export function listWorkspaces(session?: string): Effect.Effect<WorkspaceInfo[], HerdrCliError> {
  return pipe(
    herdrCliJson<{
      result?: { workspaces?: Array<Record<string, unknown>> };
    }>(["workspace", "list"], session),
    Effect.map((json) => {
      const raw = json.result?.workspaces ?? [];
      return raw.map((w) => ({
        workspaceId: String(w.workspace_id ?? ""),
        label: String(w.label ?? ""),
        cwd: String(w.cwd ?? ""),
        focused: Boolean(w.focused),
        tabCount: typeof w.tab_count === "number" ? w.tab_count : 0,
        paneCount: typeof w.pane_count === "number" ? w.pane_count : 0,
      }));
    })
  );
}

/** Get details for a single workspace. */
export function getWorkspace(
  workspaceId: string,
  session?: string
): Effect.Effect<WorkspaceInfo, HerdrCliError> {
  return pipe(
    herdrCliJson<{ result?: { workspace?: Record<string, unknown> } }>(
      ["workspace", "get", workspaceId],
      session
    ),
    Effect.map((json) => {
      const w = json.result?.workspace ?? {};
      return {
        workspaceId: String(w.workspace_id ?? workspaceId),
        label: String(w.label ?? ""),
        cwd: String(w.cwd ?? ""),
        focused: Boolean(w.focused),
        tabCount: typeof w.tab_count === "number" ? w.tab_count : 0,
        paneCount: typeof w.pane_count === "number" ? w.pane_count : 0,
      };
    })
  );
}

export interface CreateWorkspaceOptions {
  cwd?: string;
  label?: string;
  env?: Record<string, string>;
  focus?: boolean;
  session?: string;
}

/** Create a new workspace. Returns the new workspace, tab, and root pane IDs. */
export function createWorkspace(
  options: CreateWorkspaceOptions = {}
): Effect.Effect<WorkspaceCreateResult, HerdrCliError> {
  const args: string[] = ["workspace", "create"];
  if (options.cwd) args.push("--cwd", options.cwd);
  if (options.label) args.push("--label", options.label);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }
  if (options.focus === true) args.push("--focus");
  if (options.focus === false) args.push("--no-focus");

  return pipe(
    herdrCliJson<{
      result?: {
        workspace?: { workspace_id?: string };
        tab?: { tab_id?: string };
        root_pane?: { pane_id?: string };
      };
    }>(args, options.session),
    Effect.map((json) => ({
      workspaceId: json.result?.workspace?.workspace_id ?? "",
      tabId: json.result?.tab?.tab_id ?? "",
      rootPaneId: json.result?.root_pane?.pane_id ?? "",
    }))
  );
}

/** Focus a workspace. */
export function focusWorkspace(
  workspaceId: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["workspace", "focus", workspaceId], session), Effect.as(void 0));
}

/** Rename a workspace. */
export function renameWorkspace(
  workspaceId: string,
  label: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["workspace", "rename", workspaceId, label], session), Effect.as(void 0));
}

/** Close a workspace. */
export function closeWorkspace(
  workspaceId: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["workspace", "close", workspaceId], session), Effect.as(void 0));
}

// ── Sync wrappers ───────────────────────────────────────────────────────

/** Sync wrapper for listWorkspaces. */
export function listWorkspacesSync(
  session?: string
): { ok: true; workspaces: WorkspaceInfo[] } | { ok: false; error: string } {
  try {
    const stdout = herdrCliJsonSync(["workspace", "list"], session);
    const json = JSON.parse(stdout) as {
      result?: { workspaces?: Array<Record<string, unknown>> };
    };
    const raw = json.result?.workspaces ?? [];
    return {
      ok: true,
      workspaces: raw.map((w) => ({
        workspaceId: String(w.workspace_id ?? ""),
        label: String(w.label ?? ""),
        cwd: String(w.cwd ?? ""),
        focused: Boolean(w.focused),
        tabCount: typeof w.tab_count === "number" ? w.tab_count : 0,
        paneCount: typeof w.pane_count === "number" ? w.pane_count : 0,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for getWorkspace. */
export function getWorkspaceSync(
  workspaceId: string,
  session?: string
): { ok: true; workspace: WorkspaceInfo } | { ok: false; error: string } {
  try {
    const stdout = herdrCliJsonSync(["workspace", "get", workspaceId], session);
    const json = JSON.parse(stdout) as {
      result?: { workspace?: Record<string, unknown> };
    };
    const w = json.result?.workspace ?? {};
    return {
      ok: true,
      workspace: {
        workspaceId: String(w.workspace_id ?? workspaceId),
        label: String(w.label ?? ""),
        cwd: String(w.cwd ?? ""),
        focused: Boolean(w.focused),
        tabCount: typeof w.tab_count === "number" ? w.tab_count : 0,
        paneCount: typeof w.pane_count === "number" ? w.pane_count : 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for createWorkspace. */
export function createWorkspaceSync(options: CreateWorkspaceOptions = {}):
  | {
      ok: true;
      workspaceId: string;
      tabId: string;
      rootPaneId: string;
      json: Record<string, unknown>;
    }
  | { ok: false; error: string } {
  try {
    const args: string[] = ["workspace", "create"];
    if (options.cwd) args.push("--cwd", options.cwd);
    if (options.label) args.push("--label", options.label);
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("--env", `${key}=${value}`);
      }
    }
    if (options.focus === true) args.push("--focus");
    if (options.focus === false) args.push("--no-focus");

    const stdout = herdrCliJsonSync(args, options.session);
    const json = JSON.parse(stdout) as Record<string, unknown>;
    const result = json.result as
      | {
          workspace?: { workspace_id?: string };
          tab?: { tab_id?: string };
          root_pane?: { pane_id?: string };
        }
      | undefined;
    return {
      ok: true,
      workspaceId: result?.workspace?.workspace_id ?? "",
      tabId: result?.tab?.tab_id ?? "",
      rootPaneId: result?.root_pane?.pane_id ?? "",
      json,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for focusWorkspace. */
export function focusWorkspaceSync(
  workspaceId: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["workspace", "focus", workspaceId], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for renameWorkspace. */
export function renameWorkspaceSync(
  workspaceId: string,
  label: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["workspace", "rename", workspaceId, label], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for closeWorkspace. */
export function closeWorkspaceSync(
  workspaceId: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["workspace", "close", workspaceId], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
