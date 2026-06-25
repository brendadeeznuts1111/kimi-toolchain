import { TOML } from "bun";
import { discoverHerdrProjectConfig } from "../../herdr-project-config.ts";
import { readText } from "../../bun-io.ts";
import { resolveOrchestratorConfig } from "../../herdr-orchestrator-config.ts";
import { getHandoffHistory, getHandoffLogPath, type HandoffLogEntry } from "../../handoff-log.ts";
import { herdrCliRun } from "../../herdr-project-cli.ts";
import { scanUpgradeAdvisor, type UpgradeScanReport } from "../../upgrade-advisor.ts";

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
  /** True when the HTTP API returned a fast empty payload while discovery warms. */
  warming?: boolean;
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

export interface DashboardScanFinding {
  file: string;
  line: number;
  ruleId: string;
  message: string;
  suggestion: string;
  snippet: string;
  /** True when this finding has an auto-fix available. */
  hasAutoFix: boolean;
}

export interface DashboardUpgradeScanPayload {
  ok: boolean;
  projectPath: string;
  report: Omit<UpgradeScanReport, "findings"> & { findings: DashboardScanFinding[] };
  fetchedAt: string;
}

/** Handoff rules with last-fired metadata from the audit log. */
export async function fetchDashboardRules(
  projectPath: string,
  dryRun = false
): Promise<DashboardRulesPayload> {
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
  const history = await getHandoffHistory(200);
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

export async function fetchDashboardHandoffs(
  projectPath: string,
  limit = 50
): Promise<DashboardHandoffsPayload> {
  return {
    ok: true,
    projectPath,
    entries: await getHandoffHistory(limit),
    fetchedAt: new Date().toISOString(),
  };
}

/** Run upgrade-advisor scan for dashboard / IPC consumers. */
export async function fetchDashboardUpgradeScan(
  projectPath: string
): Promise<DashboardUpgradeScanPayload> {
  const report = await scanUpgradeAdvisor(projectPath);
  const findings: DashboardScanFinding[] = report.findings.map((f) => ({
    file: f.file,
    line: f.line,
    ruleId: f.ruleId,
    message: f.message,
    suggestion: f.suggestion,
    snippet: f.snippet,
    hasAutoFix: typeof f.autoFix === "function",
  }));
  const { findings: _, ...reportWithoutFindings } = report;
  return {
    ok: true,
    projectPath,
    report: {
      ...reportWithoutFindings,
      findings,
    },
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
    const entries = (await fetchDashboardHandoffs(projectPath, Number.isFinite(limit) ? limit : 20))
      .entries;
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
    scan: payload.report as UpgradeScanReport,
  };
}

export interface DashboardScanFixRequest {
  ruleId: string;
  file: string;
  line: number;
}

export interface DashboardScanFixResult {
  ok: boolean;
  ruleId: string;
  file: string;
  diff: string;
  message: string;
}

/** Apply an auto-fix for a specific scan finding. */
export async function runDashboardScanFix(
  projectPath: string,
  request: DashboardScanFixRequest
): Promise<DashboardScanFixResult> {
  // Re-scan targeting the specific rule to get the finding with its autoFix
  const report = await scanUpgradeAdvisor(projectPath, { rules: [request.ruleId] });
  const finding = report.findings.find(
    (f) => f.ruleId === request.ruleId && f.file === request.file && f.line === request.line
  );

  if (!finding?.autoFix) {
    return {
      ok: false,
      ruleId: request.ruleId,
      file: request.file,
      diff: "",
      message: "No auto-fix available for this finding",
    };
  }

  const result = finding.autoFix();
  return {
    ok: result.ok,
    ruleId: request.ruleId,
    file: request.file,
    diff: result.diff,
    message: result.ok ? "Fix applied" : "Fix could not be applied",
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
