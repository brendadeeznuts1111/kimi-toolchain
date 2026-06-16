import type { HerdrProjectConfig } from "./herdr-project-config.ts";
import { resolveAgentArgv } from "./herdr-agents.ts";
import {
  execCli,
  execCliJson,
  herdrCliJson,
  herdrCliRun,
  herdrSessionArgs,
  resolveHerdrPanePath,
  resolveHerdrSession,
} from "./herdr-project-cli.ts";

function parseHerdrPaneId(
  payload: { result?: Record<string, unknown> } | null,
  fallback: string | null
) {
  const result = payload?.result;
  const pane = result?.pane as { pane_id?: string } | undefined;
  const rootPane = (result?.root_pane || result?.rootPane) as { pane_id?: string } | undefined;
  return pane?.pane_id || rootPane?.pane_id || fallback || null;
}

export interface GrokRoleTabCommand {
  kind: "grok-role";
  agent: "grok";
  role: string;
  cwd: string;
  payload: string;
  argv: string[];
  raw: string;
}

export type TabCommandStrategy = "pane_run" | "grok_role_agent";

function herdrArgvPrefix(session?: string): string[] {
  return herdrSessionArgs(resolveHerdrSession(session));
}

function configSessionArgs(config: HerdrProjectConfig): string[] {
  const session = config.session?.trim();
  return herdrArgvPrefix(session || undefined);
}

/** Tokenize a simple shell command (quotes respected; no expansions). */
export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let value = "";
      while (i < command.length && command[i] !== quote) {
        value += command[i];
        i++;
      }
      if (command[i] === quote) i++;
      tokens.push(value);
      continue;
    }
    let end = i;
    while (end < command.length && !/\s/.test(command[end])) end++;
    tokens.push(command.slice(i, end));
    i = end;
  }
  return tokens;
}

/**
 * Parse scaffold v2 test tab commands:
 *   grok --role <name> [--cwd <path>] -- <payload>
 */
export function parseGrokRoleTabCommand(command: string): GrokRoleTabCommand | null {
  const raw = command.trim();
  if (!raw.startsWith("grok ")) return null;

  const rolePrefix = raw.match(/^grok\s+--role\s+(\S+)/);
  if (!rolePrefix) return null;

  const role = rolePrefix[1]!;
  let rest = raw.slice(rolePrefix[0].length).trim();

  let cwd = ".";
  const cwdMatch = rest.match(/^--cwd\s+(\S+)/);
  if (cwdMatch) {
    cwd = cwdMatch[1]!;
    rest = rest.slice(cwdMatch[0].length).trim();
  }

  if (!rest.startsWith("--")) return null;
  const payload = rest.slice(2).trim();
  if (!payload) return null;

  return {
    kind: "grok-role",
    agent: "grok",
    role,
    cwd,
    payload,
    argv: tokenizeShellCommand(raw),
    raw,
  };
}

export function tabCommandStrategy(command: string): TabCommandStrategy {
  return parseGrokRoleTabCommand(command) ? "grok_role_agent" : "pane_run";
}

export function resolveRoleTabCwd(config: HerdrProjectConfig, cwd: string): string {
  if (!cwd || cwd === ".") return config.projectPath || cwd || ".";
  return cwd;
}

export interface RoleTabAgentPlan {
  strategy: "grok_role_agent";
  agent: string;
  role: string;
  cwd: string;
  argv: string[];
  renameTo: string;
  reportAgent?: {
    source: string;
    agent: string;
    state: string;
    customStatus: string;
  };
}

export function planGrokRoleTabAgent(
  config: HerdrProjectConfig,
  command: string,
  options: { tabLabel?: string; customStatus?: string } = {}
): RoleTabAgentPlan | null {
  const parsed = parseGrokRoleTabCommand(command);
  if (!parsed) return null;

  const argv = [...parsed.argv];
  const grokPath = resolveAgentArgv("grok")[0];
  if (argv[0] === "grok") argv[0] = grokPath;

  const customStatus = options.customStatus || options.tabLabel || parsed.role;

  return {
    strategy: "grok_role_agent",
    agent: parsed.agent,
    role: parsed.role,
    cwd: resolveRoleTabCwd(config, parsed.cwd),
    argv,
    renameTo: parsed.role,
    reportAgent: {
      source: "kimi-toolchain:herdr-project",
      agent: parsed.role,
      state: "working",
      customStatus,
    },
  };
}

export function buildRoleTabAgentStartArgs(
  config: HerdrProjectConfig,
  workspaceId: string,
  plan: RoleTabAgentPlan,
  target: { tabId?: string | null; paneId?: string | null } = {}
): string[] {
  const args = [
    ...configSessionArgs(config),
    "agent",
    "start",
    plan.agent,
    "--cwd",
    plan.cwd,
    "--no-focus",
    "--workspace",
    workspaceId,
  ];
  if (target.tabId) args.push("--tab", target.tabId);
  const panePath = resolveHerdrPanePath();
  if (panePath) args.push("--env", `PATH=${panePath}`);
  args.push("--", ...plan.argv);
  return args;
}

export function buildGrokRoleRenameArgs(
  session: string | undefined,
  paneId: string,
  renameTo: string
): string[] {
  const resolved = session?.trim() || undefined;
  return [...herdrArgvPrefix(resolved), "agent", "rename", paneId, renameTo];
}

export function buildGrokRoleReportAgentArgs(
  session: string | undefined,
  paneId: string,
  report: NonNullable<RoleTabAgentPlan["reportAgent"]>
): string[] {
  const resolved = session?.trim() || undefined;
  return [
    ...herdrArgvPrefix(resolved),
    "pane",
    "report-agent",
    paneId,
    "--source",
    report.source,
    "--agent",
    report.agent,
    "--state",
    report.state,
    "--custom-status",
    report.customStatus,
  ];
}

export type GrokRoleStartMode = "pane_run" | "agent_start";

export function resolveGrokRoleStartMode(target: RunTabCommandTarget): GrokRoleStartMode {
  if (target.paneId?.trim()) return "pane_run";
  return "agent_start";
}

export function paneExists(session: string | undefined, paneId: string): boolean {
  const resolved = session?.trim() || undefined;
  return herdrCliJson(resolved, ["pane", "get", paneId]).ok;
}

export function buildGrokRolePaneRunPayload(command: string): string {
  let payload = command;
  const path = resolveHerdrPanePath();
  if (path) {
    const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    payload = `export PATH="${escapedPath}"; ${command}`;
  }
  return `sh -lc ${shellQuote(payload)}`;
}

export function buildGrokRolePaneRunArgs(
  session: string | undefined,
  paneId: string,
  command: string
): string[] {
  const resolved = session?.trim() || undefined;
  return [
    ...herdrArgvPrefix(resolved),
    "pane",
    "run",
    paneId,
    buildGrokRolePaneRunPayload(command),
  ];
}

export interface GrokRoleTabStartSteps {
  mode: GrokRoleStartMode;
  paneId: string | null;
  start: string[];
  rename: string[];
  reportAgent: string[];
}

export function buildGrokRoleTabStartSteps(
  config: HerdrProjectConfig,
  workspaceId: string,
  command: string,
  target: RunTabCommandTarget,
  options: { paneExists?: boolean } = {}
): GrokRoleTabStartSteps | null {
  const plan = planGrokRoleTabAgent(config, command, { tabLabel: target.tabLabel });
  if (!plan?.reportAgent) return null;

  const candidatePaneId = target.paneId?.trim() || null;
  const mode = options.paneExists === false ? "agent_start" : resolveGrokRoleStartMode(target);

  if (mode === "pane_run" && candidatePaneId) {
    const parsed = parseGrokRoleTabCommand(command);
    // layout.apply leaves a shell pane — run the grok payload, not agent start argv.
    const runCommand = parsed?.payload || command;
    return {
      mode,
      paneId: candidatePaneId,
      start: buildGrokRolePaneRunArgs(
        config.session?.trim() || undefined,
        candidatePaneId,
        runCommand
      ),
      rename: buildGrokRoleRenameArgs(
        config.session?.trim() || undefined,
        candidatePaneId,
        plan.renameTo
      ),
      reportAgent: buildGrokRoleReportAgentArgs(
        config.session?.trim() || undefined,
        candidatePaneId,
        plan.reportAgent
      ),
    };
  }

  return {
    mode: "agent_start",
    paneId: null,
    start: buildRoleTabAgentStartArgs(config, workspaceId, plan, target),
    rename: [],
    reportAgent: [],
  };
}

/** Ordered herdr argv after layout.apply / create_tab for grok --role tabs (testable). */
export function grokRoleTabCliSequence(
  config: HerdrProjectConfig,
  workspaceId: string,
  command: string,
  target: RunTabCommandTarget & { paneId: string },
  options: { paneExists?: boolean } = {}
): { mode: GrokRoleStartMode; start: string[]; rename: string[]; reportAgent: string[] } | null {
  const steps = buildGrokRoleTabStartSteps(config, workspaceId, command, target, {
    paneExists: options.paneExists ?? true,
  });
  if (!steps) return null;
  if (steps.mode === "agent_start") {
    const plan = planGrokRoleTabAgent(config, command, { tabLabel: target.tabLabel });
    if (!plan?.reportAgent) return null;
    return {
      mode: steps.mode,
      start: steps.start,
      rename: buildGrokRoleRenameArgs(config.session, target.paneId, plan.renameTo),
      reportAgent: buildGrokRoleReportAgentArgs(config.session, target.paneId, plan.reportAgent),
    };
  }
  return {
    mode: steps.mode,
    start: steps.start,
    rename: steps.rename,
    reportAgent: steps.reportAgent,
  };
}

export function parseHerdrTabId(
  payload: { result?: Record<string, unknown> } | null
): string | null {
  const result = payload?.result;
  if (!result) return null;
  const tab = result.tab as { tab_id?: string } | undefined;
  if (tab?.tab_id) return tab.tab_id;
  if (typeof result.tab_id === "string") return result.tab_id;
  const pane = result.pane as { tab_id?: string } | undefined;
  return pane?.tab_id || null;
}

export interface RunTabCommandTarget {
  tabId?: string | null;
  paneId?: string | null;
  tabLabel?: string;
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function paneRunCommand(config: HerdrProjectConfig, paneId: string, command: string) {
  return herdrCliRun(config.session, ["pane", "run", paneId, buildGrokRolePaneRunPayload(command)]);
}

function finalizeGrokRolePane(
  config: HerdrProjectConfig,
  plan: RoleTabAgentPlan,
  paneId: string
): { ok: boolean; output?: string } {
  const session = config.session?.trim() || undefined;
  if (plan.renameTo) {
    const renamed = execCli("herdr", buildGrokRoleRenameArgs(session, paneId, plan.renameTo));
    if (!renamed.ok) return { ok: false, output: renamed.output || "agent rename failed" };
  }

  if (plan.reportAgent) {
    const reported = execCli(
      "herdr",
      buildGrokRoleReportAgentArgs(session, paneId, plan.reportAgent)
    );
    if (!reported.ok) return { ok: false, output: reported.output || "report-agent failed" };
  }

  return { ok: true };
}

export function startGrokRoleTabAgent(
  config: HerdrProjectConfig,
  workspaceId: string,
  command: string,
  target: RunTabCommandTarget = {}
): { ok: boolean; paneId?: string | null; output?: string } {
  const plan = planGrokRoleTabAgent(config, command, { tabLabel: target.tabLabel });
  if (!plan) return { ok: false, output: "not a grok --role tab command" };

  const steps = buildGrokRoleTabStartSteps(config, workspaceId, command, target);
  if (!steps) return { ok: false, output: "not a grok --role tab command" };

  if (steps.mode === "pane_run" && steps.paneId) {
    const ran = execCli("herdr", steps.start);
    if (!ran.ok) return { ok: false, output: ran.output || "pane run failed" };
    const finalized = finalizeGrokRolePane(config, plan, steps.paneId);
    return finalized.ok
      ? { ok: true, paneId: steps.paneId }
      : { ok: false, output: finalized.output };
  }

  const started = execCliJson("herdr", steps.start);
  if (!started.ok) {
    return { ok: false, output: started.error || "agent start failed" };
  }

  const paneId = parseHerdrPaneId(started.json, null);
  if (!paneId) return { ok: false, output: "agent start missing pane_id" };

  const finalized = finalizeGrokRolePane(config, plan, paneId);
  return finalized.ok ? { ok: true, paneId } : { ok: false, output: finalized.output };
}

/** Run a profile tab command — pane.run for shells, agent start for grok --role. */
export function runTabCommand(
  config: HerdrProjectConfig,
  workspaceId: string,
  command: string,
  target: RunTabCommandTarget = {}
): { ok: boolean; output?: string } {
  if (tabCommandStrategy(command) === "grok_role_agent") {
    const started = startGrokRoleTabAgent(config, workspaceId, command, target);
    return started.ok
      ? { ok: true }
      : { ok: false, output: started.output || "grok role agent start failed" };
  }

  const paneId = target.paneId;
  if (!paneId) return { ok: false, output: "pane_run requires paneId" };
  const ran = paneRunCommand(config, paneId, command);
  return ran.ok ? { ok: true } : { ok: false, output: ran.output || "tab command failed" };
}
