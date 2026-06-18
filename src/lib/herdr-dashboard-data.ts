/**
 * herdr-dashboard-data.ts — Agent, handoff, and rule payloads for the WebView dashboard.
 */

export type { DashboardFetchOptions, DashboardSessionCatalog } from "./herdr-dashboard-contract.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { readText } from "./bun-io.ts";
import { TOML } from "bun";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { getHandoffHistory, getHandoffLogPath, type HandoffLogEntry } from "./handoff-log.ts";
import { herdrCliRun } from "./herdr-project-cli.ts";
import { scanUpgradeAdvisor, type UpgradeScanReport } from "./upgrade-advisor.ts";
import { LOCAL_DOC_REFERENCES } from "./canonical-references.ts";

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
  scan?: UpgradeScanReport;
}

export interface DashboardUpgradeScanPayload {
  ok: boolean;
  projectPath: string;
  report: UpgradeScanReport;
  fetchedAt: string;
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

/** Run upgrade-advisor scan for dashboard / IPC consumers. */
export async function fetchDashboardUpgradeScan(
  projectPath: string
): Promise<DashboardUpgradeScanPayload> {
  const report = await scanUpgradeAdvisor(projectPath);
  return {
    ok: true,
    projectPath,
    report,
    fetchedAt: new Date().toISOString(),
  };
}

/** Map WebView IPC commands to orchestrator actions. */
export async function runDashboardIpcCommand(
  projectPath: string,
  body: DashboardIpcCommand
): Promise<DashboardIpcResult> {
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

  if (command === "scan.run") {
    return runDashboardUpgradeScan(projectPath);
  }

  return { ok: false, command, message: `unknown command: ${command}` };
}

/** IPC + API entry for upgrade-advisor JSON report. */
export async function runDashboardUpgradeScan(projectPath: string): Promise<DashboardIpcResult> {
  const payload = await fetchDashboardUpgradeScan(projectPath);
  const total = payload.report.summary.total;
  return {
    ok: true,
    command: "scan.run",
    message: total === 0 ? "upgrade-advisor: no findings" : `upgrade-advisor: ${total} finding(s)`,
    scan: payload.report,
  };
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

// ── Canvas navigator ─────────────────────────────────────────────────

export interface DashboardCanvasEntry {
  /** Manifest domain id (e.g. "code-references") */
  id: string;
  /** Canvas self-identifier (e.g. "doc-links-and-see-ladder"). Matches CANVAS_ROUTING.id. */
  canvasId: string;
  /** Canvas display name (e.g. "Doc links") — from CANVAS_ROUTING.page */
  page: string;
  /** Repo-relative path (e.g. docs/canvases/doc-links-and-see-ladder.canvas.tsx) */
  path: string;
  /** Manifest purpose string */
  purpose: string;
  /** Canvas version (e.g. "0.1.0") — from CANVAS_ROUTING.version */
  version?: string;
  /** Canvas layer label (e.g. "Doc URL lint") — from CANVAS_ROUTING.layer */
  layer?: string;
  /** When-to-open hint (e.g. "@see ladder") — from CANVAS_ROUTING.openWhen */
  openWhen?: string;
}

export interface DashboardCanvasesPayload {
  ok: boolean;
  canvases: DashboardCanvasEntry[];
  fetchedAt: string;
}

/** All manifest-backed cursorCanvas companions for the dashboard navigator. */
export function fetchDashboardCanvases(): DashboardCanvasesPayload {
  const canvases: DashboardCanvasEntry[] = [];
  const canvasPrefix = "docs/canvases/";

  for (const ref of LOCAL_DOC_REFERENCES) {
    if (!ref.cursorCanvas) continue;
    canvases.push({
      id: ref.id,
      canvasId:
        ref.canvasId ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", ""),
      page: ref.canvasPage ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", ""),
      path: ref.cursorCanvas,
      purpose: ref.purpose ?? "",
      version: ref.canvasVersion,
      layer: ref.canvasLayer,
      openWhen: ref.canvasOpenWhen,
    });
  }

  return {
    ok: true,
    canvases,
    fetchedAt: new Date().toISOString(),
  };
}
