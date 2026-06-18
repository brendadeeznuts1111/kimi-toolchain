/**
 * herdr-dashboard-data.ts — Agent, handoff, and rule payloads for the WebView dashboard.
 */

import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { readText } from "./bun-io.ts";
import { TOML } from "bun";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { getHandoffHistory, getHandoffLogPath, type HandoffLogEntry } from "./handoff-log.ts";
import { herdrCliRun } from "./herdr-project-cli.ts";
import { getDashboardAgents } from "./herdr-dashboard-agents.ts";

export const DEFAULT_DASHBOARD_PORT = 18412;

export interface DashboardAgentRow {
  host: string;
  session: string;
  workspaceId: string;
  agent: string;
  status: string;
  paneId: string;
  source: string;
}

export interface DashboardAgentsPayload {
  ok: boolean;
  projectPath: string;
  agentCount: number;
  agents: DashboardAgentRow[];
  error?: string;
  fetchedAt: string;
}

export interface DashboardRuleRow {
  index: number;
  condition: string;
  active: boolean;
  lastFired?: string;
  lastAction?: string;
  lastOk?: boolean;
  dryRun: boolean;
}

export interface DashboardRulesPayload {
  ok: boolean;
  projectPath: string;
  dryRun: boolean;
  logPath: string;
  rules: DashboardRuleRow[];
  fetchedAt: string;
}

export interface DashboardHandoffsPayload {
  ok: boolean;
  projectPath: string;
  entries: HandoffLogEntry[];
  fetchedAt: string;
}

export interface DashboardFetchOptions {
  sessions?: boolean;
  host?: string;
  domain?: string;
  includeDoctor?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

export interface DashboardActionRequest {
  action: "attach" | "stop" | "restart";
  agent: string;
  host?: string;
  session?: string;
  workspaceId?: string;
  paneId?: string;
}

export interface DashboardActionResult {
  ok: boolean;
  action: string;
  message: string;
  command?: string;
}

export interface DashboardIpcCommand {
  command: string;
  args?: Record<string, unknown>;
}

export interface DashboardIpcResult {
  ok: boolean;
  command: string;
  message: string;
  result?: DashboardActionResult;
}

/** In-process agent discovery — same logic as `herdr-orchestrator dashboard --json`. */
export async function fetchDashboardAgents(
  projectPath: string,
  options: DashboardFetchOptions = {}
): Promise<DashboardAgentsPayload> {
  return getDashboardAgents(projectPath, options);
}

/** Handoff rules with last-fired metadata from the audit log. */
export function fetchDashboardRules(projectPath: string, dryRun = false): DashboardRulesPayload {
  const fetchedAt = new Date().toISOString();
  const config = discoverHerdrProjectConfig(projectPath);
  if (!config?.enabled) {
    return {
      ok: false,
      projectPath,
      dryRun,
      logPath: getHandoffLogPath(),
      rules: [],
      fetchedAt,
    };
  }

  const doc = (() => {
    if (!config.sourcePath) return null;
    try {
      return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const orch = resolveOrchestratorConfig({ ...config, projectPath }, doc);
  const history = getHandoffHistory(200);
  const rules: DashboardRuleRow[] = orch.handoffRules.map((rule, index) => {
    const last = history.find((entry) => entry.rule === index);
    return {
      index,
      condition: rule.when?.length ? JSON.stringify(rule.when) : rule.condition,
      active: true,
      lastFired: last?.timestamp,
      lastAction: last?.action,
      lastOk: last?.ok,
      dryRun,
    };
  });

  return {
    ok: true,
    projectPath,
    dryRun,
    logPath: getHandoffLogPath(),
    rules,
    fetchedAt,
  };
}

export function fetchDashboardHandoffs(projectPath: string, limit = 50): DashboardHandoffsPayload {
  return {
    ok: true,
    projectPath,
    entries: getHandoffHistory(limit),
    fetchedAt: new Date().toISOString(),
  };
}

/** Map WebView IPC commands to orchestrator actions. */
export function runDashboardIpcCommand(
  projectPath: string,
  body: DashboardIpcCommand
): DashboardIpcResult {
  const { command, args = {} } = body;
  const agent = String(args.agent ?? "");
  if (!command) {
    return { ok: false, command: "", message: "command required" };
  }

  if (command === "agent.attach" || command === "agent.restart" || command === "agent.stop") {
    const action = command.split(".")[1] as DashboardActionRequest["action"];
    const result = runDashboardAgentAction({
      action,
      agent,
      host: args.host as string | undefined,
      session: args.session as string | undefined,
      workspaceId: args.workspaceId as string | undefined,
      paneId: args.paneId as string | undefined,
    });
    return {
      ok: result.ok,
      command,
      message: result.message,
      result,
    };
  }

  if (command === "audit.tail") {
    const limit = Number(args.lines ?? 20);
    const entries = fetchDashboardHandoffs(
      projectPath,
      Number.isFinite(limit) ? limit : 20
    ).entries;
    return {
      ok: true,
      command,
      message: `tail ${entries.length} handoff entries`,
    };
  }

  return { ok: false, command, message: `unknown command: ${command}` };
}

/** Run a local pane/agent action from the dashboard UI. */
export function runDashboardAgentAction(request: DashboardActionRequest): DashboardActionResult {
  const host = request.host?.trim() || "(local)";
  const session = request.session?.trim() || "";

  if (host !== "(local)" && host !== "local") {
    const cmd = [
      "herdr-orchestrator",
      "agent",
      request.action,
      request.agent,
      "--host",
      host,
      ...(session ? ["--session", session] : []),
    ].join(" ");
    return {
      ok: false,
      action: request.action,
      message: `Remote actions run via CLI: ${cmd}`,
      command: cmd,
    };
  }

  if (request.action === "attach") {
    if (!request.paneId) {
      return { ok: false, action: request.action, message: "Missing paneId for attach" };
    }
    const result = herdrCliRun(session, ["pane", "focus", request.paneId]);
    return {
      ok: result.ok,
      action: request.action,
      message: result.ok ? `Focused pane ${request.paneId}` : result.output,
    };
  }

  const result = herdrCliRun(session, ["agent", request.action, request.agent]);
  return {
    ok: result.ok,
    action: request.action,
    message: result.ok ? `${request.action} ${request.agent}` : result.output,
  };
}
