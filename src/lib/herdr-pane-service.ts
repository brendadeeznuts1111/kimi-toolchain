/**
 * herdr-pane-service.ts — Effect-based herdr pane operations
 *
 * Wraps the `herdr pane` CLI family in typed Effect services using Bun.spawn.
 * Covers all operations from the Herdr CLI reference + agent SKILL.
 *
 * Uses the same session/env resolution as herdr-project-cli.ts for consistency
 * with the rest of the toolchain.
 */

import { Effect, pipe } from "effect";
import { resolveHerdrPanePath } from "./herdr-project-cli.ts";
import { herdrCli, herdrCliJsonSync, herdrCliSync, type HerdrCliError } from "./herdr-cli.ts";
import { ensureJsonArgs } from "./herdr-project-cli.ts";
// Re-export for consumers (herdr-doctor, herdr-workspace-service)
export { resolveHerdrPanePath };

// ── Types ───────────────────────────────────────────────────────────────

export type { HerdrCliError } from "./herdr-cli.ts";

export interface HerdrJsonError {
  _tag: "HerdrJsonError";
  message: string;
  raw: string;
}

export type HerdrPaneError = HerdrCliError | HerdrJsonError;

export interface PaneInfo {
  paneId: string;
  tabId: string;
  workspaceId: string;
  focused: boolean;
  agent: string | null;
  agentStatus: string | null;
  title: string;
  cwd: string;
  isShell: boolean;
}

export interface PaneLayout {
  paneId: string;
  layout: unknown;
}

export interface PaneProcessInfo {
  paneId: string;
  pid: number | null;
  command: string;
  args: string[];
}

export interface PaneNeighbor {
  paneId: string;
  direction: string;
}

export interface PaneEdges {
  paneId: string;
  top: string | null;
  bottom: string | null;
  left: string | null;
  right: string | null;
}

export interface SplitResult {
  paneId: string;
  tabId: string;
  workspaceId: string;
}

export interface WaitOutputResult {
  matched: boolean;
  match: string | null;
  timedOut: boolean;
}

export interface WaitAgentResult {
  matched: boolean;
  status: string;
  timedOut: boolean;
}

// ── CLI invocation (Bun-native) ─────────────────────────────────────────

function herdrJsonError(raw: string, context: string): HerdrJsonError {
  return {
    _tag: "HerdrJsonError" as const,
    message: `herdr ${context}: invalid JSON`,
    raw: raw.slice(0, 500),
  };
}

/** Run herdr CLI and parse JSON output. */
function herdrCliJson<T>(args: string[], session?: string): Effect.Effect<T, HerdrPaneError> {
  return pipe(
    herdrCli(ensureJsonArgs(args), session),
    Effect.mapError((err) => err as HerdrPaneError),
    Effect.flatMap((stdout) => {
      try {
        return Effect.succeed(JSON.parse(stdout) as T);
      } catch {
        return Effect.fail(herdrJsonError(stdout, args[0] || "cli"));
      }
    })
  );
}

// ── Pane listing ────────────────────────────────────────────────────────

/** List all panes in the current session. */
export function listPanes(
  workspaceId?: string,
  session?: string
): Effect.Effect<PaneInfo[], HerdrPaneError> {
  return pipe(
    herdrCliJson<{
      result?: { panes?: Array<Record<string, unknown>> };
    }>(workspaceId ? ["pane", "list", "--workspace", workspaceId] : ["pane", "list"], session),
    Effect.map((json) => {
      const raw = json.result?.panes ?? [];
      return raw.map((p) => ({
        paneId: String(p.pane_id ?? ""),
        tabId: String(p.tab_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        focused: Boolean(p.focused),
        agent: typeof p.agent === "string" ? p.agent : null,
        agentStatus: typeof p.agent_status === "string" ? p.agent_status : null,
        title: String(p.title ?? ""),
        cwd: String(p.cwd ?? ""),
        isShell: !p.agent || String(p.agent).length === 0,
      }));
    })
  );
}

/** Get details for a single pane. */
export function getPane(paneId: string, session?: string): Effect.Effect<PaneInfo, HerdrPaneError> {
  return herdrCliJson<{
    result?: { pane?: Record<string, unknown> };
  }>(["pane", "get", paneId], session).pipe(
    Effect.map((json) => {
      const p = json.result?.pane ?? {};
      return {
        paneId: String(p.pane_id ?? paneId),
        tabId: String(p.tab_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        focused: Boolean(p.focused),
        agent: typeof p.agent === "string" ? p.agent : null,
        agentStatus: typeof p.agent_status === "string" ? p.agent_status : null,
        title: String(p.title ?? ""),
        cwd: String(p.cwd ?? ""),
        isShell: !p.agent || String(p.agent).length === 0,
      };
    })
  );
}

/** Get the currently focused pane. */
export function currentPane(session?: string): Effect.Effect<PaneInfo, HerdrPaneError> {
  return pipe(
    herdrCliJson<{
      result?: { pane?: Record<string, unknown> };
    }>(["pane", "current"], session),
    Effect.map((json) => {
      const p = json.result?.pane ?? {};
      return {
        paneId: String(p.pane_id ?? ""),
        tabId: String(p.tab_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        focused: true,
        agent: typeof p.agent === "string" ? p.agent : null,
        agentStatus: typeof p.agent_status === "string" ? p.agent_status : null,
        title: String(p.title ?? ""),
        cwd: String(p.cwd ?? ""),
        isShell: !p.agent || String(p.agent).length === 0,
      };
    })
  );
}

// ── Pane split & lifecycle ──────────────────────────────────────────────

export interface SplitOptions {
  direction: "right" | "down";
  ratio?: number;
  cwd?: string;
  env?: Record<string, string>;
  focus?: boolean;
  session?: string;
}

/** Split a pane and return the new pane info. */
export function splitPane(
  paneId: string,
  options: SplitOptions
): Effect.Effect<SplitResult, HerdrPaneError> {
  const args: string[] = ["pane", "split", paneId, "--direction", options.direction];
  if (options.ratio != null) args.push("--ratio", String(options.ratio));
  if (options.cwd) args.push("--cwd", options.cwd);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }
  if (options.focus === true) args.push("--focus");
  if (options.focus === false) args.push("--no-focus");

  return herdrCliJson<{
    result?: { pane?: { pane_id?: string; tab_id?: string; workspace_id?: string } };
  }>(args, options.session).pipe(
    Effect.map((json) => ({
      paneId: json.result?.pane?.pane_id ?? "",
      tabId: json.result?.pane?.tab_id ?? "",
      workspaceId: json.result?.pane?.workspace_id ?? "",
    }))
  );
}

/** Close a pane. */
export function closePane(paneId: string, session?: string): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["pane", "close", paneId], session), Effect.as(void 0));
}

// ── Pane run / send ─────────────────────────────────────────────────────

/** Send text + Enter atomically (preferred over sendText + sendKeys Enter). */
export function paneRun(
  paneId: string,
  command: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["pane", "run", paneId, command], session), Effect.as(void 0));
}

/** Send text without pressing Enter. */
export function sendText(
  paneId: string,
  text: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["pane", "send-text", paneId, text], session), Effect.as(void 0));
}

/** Send key sequence (Enter, Escape, ctrl+c, etc.). */
export function sendKeys(
  paneId: string,
  keys: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["pane", "send-keys", paneId, keys], session), Effect.as(void 0));
}

// ── Pane read ───────────────────────────────────────────────────────────

export type PaneReadSource = "visible" | "recent" | "recent-unwrapped";

export interface PaneReadOptions {
  source?: PaneReadSource;
  lines?: number;
  ansi?: boolean;
  session?: string;
}

/** Read pane output. Returns plain text (not JSON). */
export function readPane(
  paneId: string,
  options: PaneReadOptions = {}
): Effect.Effect<string, HerdrCliError> {
  const args: string[] = ["pane", "read", paneId];
  args.push("--source", options.source ?? "recent");
  if (options.lines != null) args.push("--lines", String(options.lines));
  if (options.ansi) args.push("--ansi");
  return herdrCli(args, options.session);
}

// ── Wait ────────────────────────────────────────────────────────────────

export interface WaitOutputOptions {
  match: string;
  regex?: boolean;
  timeoutMs?: number;
  session?: string;
}

/** Block until text matches in a pane's output. */
export function waitOutput(
  paneId: string,
  options: WaitOutputOptions
): Effect.Effect<WaitOutputResult, HerdrCliError> {
  const args: string[] = [
    "wait",
    "output",
    paneId,
    "--match",
    options.match,
    "--timeout",
    String(options.timeoutMs ?? 30000),
  ];
  if (options.regex) args.push("--regex");

  return pipe(
    herdrCli(args, options.session),
    Effect.map((stdout) => {
      try {
        const json = JSON.parse(stdout) as { result?: { matched?: boolean; match?: string } };
        return {
          matched: json.result?.matched ?? true,
          match: json.result?.match ?? null,
          timedOut: false,
        };
      } catch {
        // herdr wait output may not print JSON — success implies matched
        return { matched: true, match: stdout.slice(0, 200), timedOut: false };
      }
    }),
    Effect.catchTag("HerdrCliError", (err) => {
      if (err.exitCode === 1 && err.stderr.includes("timed out")) {
        return Effect.succeed({ matched: false, match: null, timedOut: true });
      }
      return Effect.fail(err);
    })
  );
}

export interface WaitAgentOptions {
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  timeoutMs?: number;
  session?: string;
}

/** Block until an agent reaches a specific status. */
export function waitAgentStatus(
  paneId: string,
  options: WaitAgentOptions
): Effect.Effect<WaitAgentResult, HerdrCliError> {
  return pipe(
    herdrCli(
      [
        "wait",
        "agent-status",
        paneId,
        "--status",
        options.status,
        "--timeout",
        String(options.timeoutMs ?? 60000),
      ],
      options.session
    ),
    Effect.map(() => ({ matched: true, status: options.status, timedOut: false })),
    Effect.catchTag("HerdrCliError", (err) => {
      if (err.exitCode === 1 && err.stderr.includes("timed out")) {
        return Effect.succeed({ matched: false, status: "unknown", timedOut: true });
      }
      return Effect.fail(err);
    })
  );
}

// ── Pane navigation ─────────────────────────────────────────────────────

export type Direction = "left" | "right" | "up" | "down";

/** Focus a pane (or navigate by direction). */
export function focusPane(
  target: { paneId: string } | { direction: Direction },
  session?: string
): Effect.Effect<void, HerdrCliError> {
  const args = ["pane", "focus"];
  if ("paneId" in target) {
    args.push(target.paneId);
  } else {
    args.push("--direction", target.direction);
  }
  return pipe(herdrCli(args, session), Effect.as(void 0));
}

/** Get neighbor pane in a direction. */
export function neighborPane(
  direction: Direction,
  paneId?: string,
  session?: string
): Effect.Effect<PaneNeighbor, HerdrPaneError> {
  const args = ["pane", "neighbor", "--direction", direction];
  if (paneId) args.push("--pane", paneId);
  else args.push("--current");
  return herdrCliJson<{
    result?: { pane_id?: string };
  }>(args, session).pipe(
    Effect.map((json) => ({
      paneId: json.result?.pane_id ?? "",
      direction,
    }))
  );
}

/** Get pane edge neighbors. */
export function paneEdges(
  paneId?: string,
  session?: string
): Effect.Effect<PaneEdges, HerdrPaneError> {
  const args = ["pane", "edges"];
  if (paneId) args.push("--pane", paneId);
  else args.push("--current");
  return herdrCliJson<{
    result?: { top?: string; bottom?: string; left?: string; right?: string };
  }>(args, session).pipe(
    Effect.map((json) => ({
      paneId: paneId ?? "",
      top: json.result?.top ?? null,
      bottom: json.result?.bottom ?? null,
      left: json.result?.left ?? null,
      right: json.result?.right ?? null,
    }))
  );
}

// ── Pane layout ─────────────────────────────────────────────────────────

/** Get pane layout tree. */
export function paneLayout(
  paneId?: string,
  session?: string
): Effect.Effect<unknown, HerdrPaneError> {
  const args = ["pane", "layout"];
  if (paneId) args.push("--pane", paneId);
  else args.push("--current");
  return herdrCliJson(args, session).pipe(
    Effect.map((json) => (json as { result?: unknown }).result ?? json)
  );
}

// ── Pane process info ───────────────────────────────────────────────────

/** Get process info for a pane. */
export function paneProcessInfo(
  paneId?: string,
  session?: string
): Effect.Effect<PaneProcessInfo, HerdrPaneError> {
  const args = ["pane", "process-info"];
  if (paneId) args.push("--pane", paneId);
  else args.push("--current");
  return herdrCliJson<{
    result?: { pane_id?: string; pid?: number; command?: string; args?: string[] };
  }>(args, session).pipe(
    Effect.map((json) => ({
      paneId: json.result?.pane_id ?? "",
      pid: typeof json.result?.pid === "number" ? json.result.pid : null,
      command: json.result?.command ?? "",
      args: json.result?.args ?? [],
    }))
  );
}

// ── Pane resize ─────────────────────────────────────────────────────────

export interface ResizeOptions {
  direction: Direction;
  amount?: number;
  paneId?: string;
  session?: string;
}

/** Resize a pane in a direction. */
export function resizePane(options: ResizeOptions): Effect.Effect<void, HerdrCliError> {
  const args = ["pane", "resize", "--direction", options.direction];
  if (options.amount != null) args.push("--amount", String(options.amount));
  if (options.paneId) args.push("--pane", options.paneId);
  else args.push("--current");
  return pipe(herdrCli(args, options.session), Effect.as(void 0));
}

// ── Pane zoom ───────────────────────────────────────────────────────────

export type ZoomAction = "toggle" | "on" | "off";

/** Zoom a pane (toggle full-screen within tab). */
export function zoomPane(
  paneId: string,
  action: ZoomAction = "toggle",
  session?: string
): Effect.Effect<void, HerdrCliError> {
  const args = ["pane", "zoom", paneId, `--${action}`];
  return pipe(herdrCli(args, session), Effect.as(void 0));
}

// ── Pane rename ─────────────────────────────────────────────────────────

/** Rename a pane or clear its label. */
export function renamePane(
  paneId: string,
  label: string | null,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  const args = label ? ["pane", "rename", paneId, label] : ["pane", "rename", paneId, "--clear"];
  return pipe(herdrCli(args, session), Effect.as(void 0));
}

// ── Pane swap ───────────────────────────────────────────────────────────

export type SwapTarget = { direction: Direction } | { sourcePaneId: string; targetPaneId: string };

/** Swap pane positions. */
export function swapPane(
  paneIdOrTarget: string | SwapTarget,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  if (typeof paneIdOrTarget === "object") {
    if ("direction" in paneIdOrTarget) {
      return pipe(
        herdrCli(["pane", "swap", "--direction", paneIdOrTarget.direction, "--current"], session),
        Effect.as(void 0)
      );
    }
    return pipe(
      herdrCli(
        [
          "pane",
          "swap",
          "--source-pane",
          paneIdOrTarget.sourcePaneId,
          "--target-pane",
          paneIdOrTarget.targetPaneId,
        ],
        session
      ),
      Effect.as(void 0)
    );
  }
  return pipe(
    herdrCli(["pane", "swap", "--direction", "right", "--pane", paneIdOrTarget], session),
    Effect.as(void 0)
  );
}

// ── Pane move ───────────────────────────────────────────────────────────

export interface MoveToTabOptions {
  tabId: string;
  split?: "right" | "down";
  targetPaneId?: string;
  ratio?: number;
  focus?: boolean;
  session?: string;
}

export interface MoveToNewTabOptions {
  workspaceId?: string;
  label?: string;
  focus?: boolean;
  session?: string;
}

export interface MoveToNewWorkspaceOptions {
  label?: string;
  tabLabel?: string;
  focus?: boolean;
  session?: string;
}

/** Move a pane to another tab, new tab, or new workspace. */
export function movePane(
  paneId: string,
  options: MoveToTabOptions | MoveToNewTabOptions | MoveToNewWorkspaceOptions,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  const args = ["pane", "move", paneId];

  if ("tabId" in options) {
    args.push("--tab", options.tabId);
    if (options.split) args.push("--split", options.split);
    if (options.targetPaneId) args.push("--target-pane", options.targetPaneId);
    if (options.ratio != null) args.push("--ratio", String(options.ratio));
    if (options.focus === true) args.push("--focus");
    if (options.focus === false) args.push("--no-focus");
  } else if ("workspaceId" in options) {
    // MoveToNewTabOptions
    args.push("--new-tab");
    if (options.workspaceId) args.push("--workspace", options.workspaceId);
    if (options.label) args.push("--label", options.label);
    if (options.focus === true) args.push("--focus");
    if (options.focus === false) args.push("--no-focus");
  } else {
    // MoveToNewWorkspaceOptions
    const mOpts = options as MoveToNewWorkspaceOptions;
    args.push("--new-workspace");
    if (mOpts.label) args.push("--label", mOpts.label);
    if (mOpts.tabLabel) args.push("--tab-label", mOpts.tabLabel);
    if (mOpts.focus === true) args.push("--focus");
    if (mOpts.focus === false) args.push("--no-focus");
  }

  return pipe(herdrCli(args, session), Effect.as(void 0));
}

// ── Convenience composables ─────────────────────────────────────────────

export interface SplitAndRunOptions {
  direction: "right" | "down";
  command: string;
  focus?: boolean;
  ratio?: number;
  cwd?: string;
  session?: string;
}

/**
 * Split a pane and run a command in the new pane.
 * Returns the new pane's ID. Convenience composition of splitPane + paneRun.
 */
export function splitAndRun(
  sourcePaneId: string,
  options: SplitAndRunOptions
): Effect.Effect<string, HerdrPaneError> {
  return Effect.gen(function* () {
    const split = yield* splitPane(sourcePaneId, {
      direction: options.direction,
      ratio: options.ratio,
      cwd: options.cwd,
      focus: options.focus ?? false,
      session: options.session,
    });

    yield* pipe(
      paneRun(split.paneId, options.command, options.session),
      Effect.mapError((err) => err as HerdrPaneError)
    );

    return split.paneId;
  });
}

/**
 * Split, run a server command, and wait for it to be ready.
 * Returns the new pane's ID and whether the ready signal was seen.
 */
export function splitRunAndWait(
  sourcePaneId: string,
  command: string,
  readyPattern: string,
  options: {
    direction?: "right" | "down";
    timeoutMs?: number;
    regex?: boolean;
    session?: string;
  } = {}
): Effect.Effect<{ paneId: string; ready: boolean }, HerdrPaneError> {
  return Effect.gen(function* () {
    const paneId = yield* splitAndRun(sourcePaneId, {
      direction: options.direction ?? "right",
      command,
      session: options.session,
    });

    const waitResult = yield* pipe(
      waitOutput(paneId, {
        match: readyPattern,
        timeoutMs: options.timeoutMs ?? 30000,
        regex: options.regex,
        session: options.session,
      }),
      Effect.mapError((err) => err as HerdrPaneError)
    );

    return { paneId, ready: waitResult.matched };
  });
}

// ── Sync wrappers (Bun.spawnSync) for consumers that need sync results ──

/** Sync wrapper for splitPane. Returns { ok, paneId, tabId, json, ... } like herdrCliJson. */
export function splitPaneSync(
  paneId: string,
  options: SplitOptions
):
  | { ok: true; paneId: string; tabId: string; workspaceId: string; json: Record<string, unknown> }
  | { ok: false; error: string } {
  try {
    const args: string[] = ["pane", "split", paneId, "--direction", options.direction];
    if (options.ratio != null) args.push("--ratio", String(options.ratio));
    if (options.cwd) args.push("--cwd", options.cwd);
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push("--env", `${key}=${value}`);
      }
    }
    args.push("--no-focus");
    const stdout = herdrCliJsonSync(args, options.session);
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const json = raw as Record<string, unknown>;
    const pane = (
      raw.result as
        | { pane?: { pane_id?: string; tab_id?: string; workspace_id?: string } }
        | undefined
    )?.pane;
    return {
      ok: true,
      paneId: pane?.pane_id ?? "",
      tabId: pane?.tab_id ?? "",
      workspaceId: pane?.workspace_id ?? "",
      json,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for closePane. Returns { ok } or { ok: false, error }. */
export function closePaneSync(
  paneId: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["pane", "close", paneId], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for paneRun. Returns { ok } or { ok: false, error }. */
export function paneRunSync(
  paneId: string,
  command: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  // Build shell command with PATH prefix (same as legacy helpers)
  const path = resolveHerdrPanePath();
  let payload = command;
  if (path) {
    const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    payload = `export PATH="${escapedPath}"; ${command}`;
  }
  const shellCmd = `sh -lc '${payload.replace(/'/g, `'\\''`)}'`;
  try {
    herdrCliSync(["pane", "run", paneId, shellCmd], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for sendKeys. Returns { ok } or { ok: false, error }. */
export function sendKeysSync(
  paneId: string,
  keys: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["pane", "send-keys", paneId, keys], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for listPanes. Parses the herdr pane list JSON output. */
export function listPanesSync(
  workspaceId?: string,
  session?: string
): { ok: true; panes: PaneInfo[] } | { ok: false; error: string } {
  try {
    const args = workspaceId ? ["pane", "list", "--workspace", workspaceId] : ["pane", "list"];
    const stdout = herdrCliJsonSync(args, session);
    const json = JSON.parse(stdout) as {
      result?: { panes?: Array<Record<string, unknown>> };
    };
    const raw = json.result?.panes ?? [];
    const panes: PaneInfo[] = raw.map((p) => ({
      paneId: String(p.pane_id ?? ""),
      tabId: String(p.tab_id ?? ""),
      workspaceId: String(p.workspace_id ?? ""),
      focused: Boolean(p.focused),
      agent: typeof p.agent === "string" ? p.agent : null,
      agentStatus: typeof p.agent_status === "string" ? p.agent_status : null,
      title: String(p.title ?? ""),
      cwd: String(p.cwd ?? ""),
      isShell: !p.agent || String(p.agent).length === 0,
    }));
    return { ok: true, panes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for getPane. Returns pane details or error. */
export function getPaneSync(
  paneId: string,
  session?: string
): { ok: true; pane: PaneInfo } | { ok: false; error: string } {
  try {
    const stdout = herdrCliJsonSync(["pane", "get", paneId], session);
    const json = JSON.parse(stdout) as {
      result?: { pane?: Record<string, unknown> };
    };
    const p = json.result?.pane ?? {};
    return {
      ok: true,
      pane: {
        paneId: String(p.pane_id ?? paneId),
        tabId: String(p.tab_id ?? ""),
        workspaceId: String(p.workspace_id ?? ""),
        focused: Boolean(p.focused),
        agent: typeof p.agent === "string" ? p.agent : null,
        agentStatus: typeof p.agent_status === "string" ? p.agent_status : null,
        title: String(p.title ?? ""),
        cwd: String(p.cwd ?? ""),
        isShell: !p.agent || String(p.agent).length === 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Tab operations ──────────────────────────────────────────────────────

export interface TabInfo {
  tabId: string;
  workspaceId: string;
  label: string;
  paneCount: number;
  focused: boolean;
}

/** List tabs in a workspace (async Effect). */
export function listTabs(
  workspaceId: string,
  session?: string
): Effect.Effect<TabInfo[], HerdrPaneError> {
  return pipe(
    herdrCliJson<{ result?: { tabs?: Array<Record<string, unknown>> } }>(
      ["tab", "list", "--workspace", workspaceId],
      session
    ),
    Effect.map((json) => {
      const raw = json.result?.tabs ?? [];
      return raw.map((t) => ({
        tabId: String(t.tab_id ?? ""),
        workspaceId: String(t.workspace_id ?? workspaceId),
        label: String(t.label ?? ""),
        paneCount: typeof t.pane_count === "number" ? t.pane_count : 0,
        focused: Boolean(t.focused),
      }));
    })
  );
}

export interface CreateTabOptions {
  workspaceId: string;
  label?: string;
  focus?: boolean;
  session?: string;
}

/** Create a new tab (async Effect). */
export function createTab(
  options: CreateTabOptions
): Effect.Effect<{ tabId: string; rootPaneId: string }, HerdrPaneError> {
  const args: string[] = ["tab", "create", "--workspace", options.workspaceId];
  if (options.label) args.push("--label", options.label);
  if (options.focus === true) args.push("--focus");
  else args.push("--no-focus");

  return pipe(
    herdrCliJson<{
      result?: { tab?: { tab_id?: string }; root_pane?: { pane_id?: string } };
    }>(args, options.session),
    Effect.map((json) => ({
      tabId: json.result?.tab?.tab_id ?? "",
      rootPaneId: json.result?.root_pane?.pane_id ?? "",
    }))
  );
}

/** Close a tab (async Effect). */
export function closeTab(tabId: string, session?: string): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["tab", "close", tabId], session), Effect.as(void 0));
}

/** Focus a tab (async Effect). */
export function focusTab(tabId: string, session?: string): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["tab", "focus", tabId], session), Effect.as(void 0));
}

/** Rename a tab (async Effect). */
export function renameTab(
  tabId: string,
  label: string,
  session?: string
): Effect.Effect<void, HerdrCliError> {
  return pipe(herdrCli(["tab", "rename", tabId, label], session), Effect.as(void 0));
}

// ── Tab sync wrappers ───────────────────────────────────────────────────

/** Sync wrapper for listTabs. */
export function listTabsSync(
  workspaceId: string,
  session?: string
): { ok: true; tabs: TabInfo[] } | { ok: false; error: string } {
  try {
    const stdout = herdrCliJsonSync(["tab", "list", "--workspace", workspaceId], session);
    const json = JSON.parse(stdout) as {
      result?: { tabs?: Array<Record<string, unknown>> };
    };
    const raw = json.result?.tabs ?? [];
    return {
      ok: true,
      tabs: raw
        .filter((t) => typeof t.tab_id === "string")
        .map((t) => ({
          tabId: t.tab_id as string,
          workspaceId: String(t.workspace_id ?? workspaceId),
          label: String(t.label ?? ""),
          paneCount: typeof t.pane_count === "number" ? t.pane_count : 0,
          focused: Boolean(t.focused),
        })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for createTab. */
export function createTabSync(
  options: CreateTabOptions
):
  | { ok: true; tabId: string; rootPaneId: string; json: Record<string, unknown> }
  | { ok: false; error: string } {
  try {
    const args: string[] = ["tab", "create", "--workspace", options.workspaceId];
    if (options.label) args.push("--label", options.label);
    if (options.focus === true) args.push("--focus");
    else args.push("--no-focus");

    const stdout = herdrCliJsonSync(args, options.session);
    const json = JSON.parse(stdout) as Record<string, unknown>;
    const result = json.result as
      | {
          tab?: { tab_id?: string };
          root_pane?: { pane_id?: string };
        }
      | undefined;
    return {
      ok: true,
      tabId: result?.tab?.tab_id ?? "",
      rootPaneId: result?.root_pane?.pane_id ?? "",
      json,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sync wrapper for closeTab. */
export function closeTabSync(
  tabId: string,
  session?: string
): { ok: true } | { ok: false; error: string } {
  try {
    herdrCliSync(["tab", "close", tabId], session);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
