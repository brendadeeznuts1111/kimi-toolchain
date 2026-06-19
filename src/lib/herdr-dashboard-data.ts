/**
 * herdr-dashboard-data.ts — Agent, handoff, and rule payloads for the WebView dashboard.
 */

export type { DashboardFetchOptions, DashboardSessionCatalog } from "./herdr-dashboard-contract.ts";
import { join } from "path";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { pathExists, readText } from "./bun-io.ts";
import { TOML } from "bun";
import { invokeTool, toolsDir } from "./tool-runner.ts";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { getHandoffHistory, getHandoffLogPath, type HandoffLogEntry } from "./handoff-log.ts";
import { herdrCliRun } from "./herdr-project-cli.ts";
import { scanUpgradeAdvisor, type UpgradeScanReport } from "./upgrade-advisor.ts";
import { LOCAL_DOC_REFERENCES } from "./canonical-references.ts";
import {
  clampDashboardLogTail,
  dashboardLogSinkPriority,
  discoverDashboardLogSinks,
  isDashboardCuratedLogSink,
  readErrorLogTail,
  type ErrorLogSinkStatus,
} from "./error-log-discovery.ts";
import { tlsComplianceGate } from "../guardian/tls-compliance.ts";
import { ArtifactStore } from "./artifact-store.ts";

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
  /** Read order for grouping (1=Hub, 2=Config/Namespace, 3=Cross-ref, 4=Scaffold, 5-6=Herdr) */
  readOrder?: number;
  /** examples/dashboard card ids influenced by this canvas (v5.4) */
  influences?: string[];
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
      readOrder: ref.canvasReadOrder,
      influences: ref.canvasInfluences ? [...ref.canvasInfluences] : undefined,
    });
  }

  canvases.sort((a, b) => (a.readOrder ?? 99) - (b.readOrder ?? 99));

  return {
    ok: true,
    canvases,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Artifact inventory ─────────────────────────────────────────────────

export interface DashboardArtifactEntry {
  gate: string;
  count: number;
  latestPath: string | null;
  latestSize?: number;
  latestResultSize?: number;
  status: string;
  summary: string;
  updatedAt: string | null;
}

export interface DashboardArtifactsPayload {
  ok: boolean;
  projectPath: string;
  probeServerUrl: string;
  probeReachable: boolean;
  artifacts: DashboardArtifactEntry[];
  fetchedAt: string;
}

export interface DashboardProbeCardsPayload {
  ok: boolean;
  url: string;
  reachable: boolean;
  summary?: { pass: number; fail: number; unknown: number; total: number };
  fetchedAt?: string;
  cards?: unknown[];
  error?: string;
}

function artifactPayloadStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const row = payload as Record<string, unknown>;
  if (typeof row.status === "string") return row.status;
  if (typeof row.ok === "boolean") return row.ok ? "pass" : "fail";
  const summary = row.summary as Record<string, unknown> | undefined;
  if (typeof summary?.ok === "boolean") return summary.ok ? "pass" : "fail";
  return "unknown";
}

function artifactPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "No payload summary";
  const row = payload as Record<string, unknown>;
  if (typeof row.message === "string") return row.message.slice(0, 160);
  if (typeof row.reason === "string") return row.reason.slice(0, 160);
  const summary = row.summary as Record<string, unknown> | undefined;
  if (summary && typeof summary === "object") {
    const parts = Object.entries(summary)
      .filter(([, value]) => typeof value !== "object")
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`);
    if (parts.length > 0) return parts.join(" · ").slice(0, 160);
  }
  return JSON.stringify(payload).slice(0, 160);
}

function artifactPayloadUpdatedAt(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  for (const key of ["fetchedAt", "generatedAt", "timestamp", "updatedAt"]) {
    if (typeof row[key] === "string") return row[key] as string;
  }
  return null;
}

const PROBE_FETCH_TIMEOUT_MS = 1200;

async function fetchServeProbeJson(
  baseUrl: string,
  path: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, baseUrl).toString(), { signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeout);
  }
}

/** Proxy serve-probe card snapshot for dashboard summary card. */
export async function fetchDashboardProbeCards(
  projectPath: string
): Promise<DashboardProbeCardsPayload> {
  const { resolveProbeServerUrl } = await import("./doctor-probe-config.ts");
  const url = await resolveProbeServerUrl(projectPath);
  const result = await fetchServeProbeJson(url, "/api/cards");
  if (!result.ok || !result.body || typeof result.body !== "object") {
    return {
      ok: false,
      url,
      reachable: false,
      error: "serve-probe unreachable — run kimi-doctor --serve-probe",
    };
  }
  const row = result.body as Record<string, unknown>;
  const summary = row.summary as DashboardProbeCardsPayload["summary"];
  return {
    ok: row.ok === true,
    url,
    reachable: true,
    summary,
    fetchedAt: typeof row.fetchedAt === "string" ? row.fetchedAt : undefined,
    cards: Array.isArray(row.cards) ? row.cards : undefined,
  };
}

/** Saved gate artifacts for the dashboard Artifacts tab. */
export async function fetchDashboardArtifacts(
  projectPath: string
): Promise<DashboardArtifactsPayload> {
  const { resolveProbeServerUrl } = await import("./doctor-probe-config.ts");
  const store = new ArtifactStore(projectPath);
  const probeServerUrl = await resolveProbeServerUrl(projectPath);
  const probeHealth = await fetchServeProbeJson(probeServerUrl, "/api/health");
  const gates = await store.listGates();
  const artifacts: DashboardArtifactEntry[] = [];

  for (const gate of gates) {
    const paths = await store.list(gate);
    const latest = await store.getLatest(gate);
    const listed = await store.listEntries(gate, { limit: 1 });
    const latestEntry = listed.entries.at(-1);
    artifacts.push({
      gate,
      count: paths.length,
      latestPath: latest?.relativePath ?? null,
      ...(latestEntry?.size !== undefined ? { latestSize: latestEntry.size } : {}),
      ...(latestEntry?.resultSize !== undefined
        ? { latestResultSize: latestEntry.resultSize }
        : {}),
      status: artifactPayloadStatus(latest?.payload),
      summary: artifactPayloadSummary(latest?.payload),
      updatedAt: artifactPayloadUpdatedAt(latest?.payload),
    });
  }

  artifacts.sort((a, b) => {
    const byLatest = String(b.latestPath ?? "").localeCompare(String(a.latestPath ?? ""));
    if (byLatest !== 0) return byLatest;
    return a.gate.localeCompare(b.gate);
  });

  return {
    ok: true,
    projectPath,
    probeServerUrl,
    probeReachable: probeHealth.ok,
    artifacts,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Gate health ──────────────────────────────────────────────────────

export interface DashboardGateCheckPayload {
  ok: boolean;
  /** When true, one or more gates are failing. */
  failed: boolean;
  failures: Array<{ name: string; message: string }>;
  total: number;
  fetchedAt: string;
}

interface EffectGatesJsonEnvelope {
  effectGates?: {
    regressions?: Array<{ gate?: string; message?: string; location?: string }>;
    current?: { summary?: { total?: number } };
  };
  violations?: Array<{ gate?: string; message?: string; location?: string; severity?: string }>;
  summary?: { ok?: boolean };
}

function resolveKimiDoctorPath(projectPath: string): string | null {
  const local = join(projectPath, "src/bin/kimi-doctor.ts");
  if (pathExists(local)) return local;
  const synced = join(toolsDir(), "kimi-doctor.ts");
  if (pathExists(synced)) return synced;
  return null;
}

function parseEffectGatesEnvelope(stdout: string): {
  failed: boolean;
  failures: Array<{ name: string; message: string }>;
  total: number;
} | null {
  try {
    const parsed = JSON.parse(stdout) as EffectGatesJsonEnvelope;
    if (parsed.summary?.ok === true) {
      return {
        failed: false,
        failures: [],
        total: parsed.effectGates?.current?.summary?.total ?? parsed.violations?.length ?? 0,
      };
    }

    const failures: Array<{ name: string; message: string }> = [];
    for (const violation of parsed.violations ?? []) {
      if (violation.severity !== "error") continue;
      const message = violation.location
        ? `${violation.message ?? "failed"} (${violation.location})`
        : String(violation.message ?? "failed");
      failures.push({ name: String(violation.gate ?? "violation"), message });
    }
    for (const regression of parsed.effectGates?.regressions ?? []) {
      failures.push({
        name: String(regression.gate ?? "regression"),
        message: String(regression.message ?? "regression detected"),
      });
    }

    return {
      failed: true,
      failures,
      total: parsed.effectGates?.current?.summary?.total ?? failures.length,
    };
  } catch {
    return null;
  }
}

/** Run a lightweight doctor gate check and return structured failures. */
export async function fetchDashboardGateHealth(
  projectPath: string
): Promise<DashboardGateCheckPayload> {
  const fetchedAt = new Date().toISOString();
  const doctorPath = resolveKimiDoctorPath(projectPath);
  if (!doctorPath) {
    return {
      ok: false,
      failed: true,
      failures: [
        {
          name: "effect-gates",
          message: "kimi-doctor not found in project src/bin or ~/.kimi-code/tools",
        },
      ],
      total: 0,
      fetchedAt,
    };
  }

  try {
    const result = await invokeTool(
      doctorPath,
      ["--effect-gates", "--json", "--project-root", projectPath],
      { cwd: projectPath, timeoutMs: 60_000 }
    );
    const stdout = result.stdout.trim() || result.stderr.trim();

    if (result.error) {
      return {
        ok: false,
        failed: true,
        failures: [{ name: "effect-gates", message: result.error }],
        total: 0,
        fetchedAt,
      };
    }

    const parsed = parseEffectGatesEnvelope(stdout);
    if (parsed) {
      return {
        ok: true,
        failed: parsed.failed,
        failures: parsed.failures,
        total: parsed.total,
        fetchedAt,
      };
    }

    return {
      ok: true,
      failed: result.exitCode !== 0,
      failures: [
        {
          name: "effect-gates",
          message: stdout.slice(0, 200) || "gate check failed",
        },
      ],
      total: 1,
      fetchedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      failed: true,
      failures: [{ name: "effect-gates", message }],
      total: 0,
      fetchedAt,
    };
  }
}

// ── Metrics ──────────────────────────────────────────────────────────

export interface DashboardMetricsPayload {
  ok: boolean;
  metrics: {
    memoryRssMB: number;
    memoryHeapMB: number;
    eventLoopLagMs: number;
    uptimeSeconds: number;
    sseConnections: number;
    agentCount: number;
  };
  fetchedAt: string;
}

async function measureEventLoopLagMs(): Promise<number> {
  const start = performance.now();
  await Bun.sleep(0);
  return Math.round((performance.now() - start) * 10) / 10;
}

/** Collect runtime performance metrics for the dashboard Metrics tab. */
export async function fetchDashboardMetrics(
  agentCount: number,
  sseConnections: number
): Promise<DashboardMetricsPayload> {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const eventLoopLagMs = await measureEventLoopLagMs();

  return {
    ok: true,
    metrics: {
      memoryRssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      memoryHeapMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      eventLoopLagMs,
      uptimeSeconds: Math.round(uptime),
      sseConnections,
      agentCount,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ── Health summary (lightweight status probes for header/summary cards) ─

export type DashboardHealthStatus = "ok" | "warn" | "error" | "unknown";

export interface DashboardHealthCheck {
  status: DashboardHealthStatus;
  message?: string;
}

export interface DashboardProbeHealthCheck extends DashboardHealthCheck {
  url: string;
  reachable: boolean;
  pass: number;
  fail: number;
  unknown: number;
}

export interface DashboardHealthPayload {
  ok: boolean;
  checks: {
    agents: DashboardHealthCheck & { count: number };
    sse: DashboardHealthCheck & { subscribers: number };
    herdr: DashboardHealthCheck & { connected: boolean; workspaceId: string | null };
    gate: DashboardHealthCheck & { failed: boolean | null };
    probe: DashboardProbeHealthCheck;
    discovery: DashboardHealthCheck & { workspaceId: string | null };
  };
  fetchedAt: string;
}

export interface DashboardHealthInput {
  agentCount: number;
  sseSubscribers: number;
  herdrConnected: boolean;
  herdrWorkspaceId: string | null;
  herdrEnabled: boolean;
  gateFailed: boolean | null;
  discoveryWorkspaceId: string | null;
  probe?: Pick<DashboardProbeHealthCheck, "url" | "reachable" | "pass" | "fail" | "unknown">;
}

/** Lightweight health snapshot for the Herdr dashboard header/summary cards. */
export function fetchDashboardHealth(input: DashboardHealthInput): DashboardHealthPayload {
  const fetchedAt = new Date().toISOString();

  const agents: DashboardHealthPayload["checks"]["agents"] = {
    status: input.agentCount > 0 ? "ok" : "warn",
    count: input.agentCount,
    message: input.agentCount > 0 ? `${input.agentCount} agent(s)` : "no agents discovered",
  };

  const sse: DashboardHealthPayload["checks"]["sse"] = {
    status: input.sseSubscribers > 0 ? "ok" : "warn",
    subscribers: input.sseSubscribers,
    message:
      input.sseSubscribers > 0
        ? `${input.sseSubscribers} subscriber(s)`
        : "no active SSE subscribers",
  };

  const herdr: DashboardHealthPayload["checks"]["herdr"] = {
    status: input.herdrEnabled ? (input.herdrConnected ? "ok" : "warn") : "unknown",
    connected: input.herdrConnected,
    workspaceId: input.herdrWorkspaceId,
    message: input.herdrEnabled
      ? input.herdrConnected
        ? `connected to ${input.herdrWorkspaceId ?? "workspace"}`
        : "herdr socket disconnected"
      : "herdr events disabled",
  };

  const gate: DashboardHealthPayload["checks"]["gate"] = {
    status: input.gateFailed === null ? "unknown" : input.gateFailed ? "error" : "ok",
    failed: input.gateFailed,
    message:
      input.gateFailed === null
        ? "gate health not yet checked"
        : input.gateFailed
          ? "effect-gates failing"
          : "effect-gates passing",
  };

  const discovery: DashboardHealthPayload["checks"]["discovery"] = {
    status: input.discoveryWorkspaceId ? "ok" : "warn",
    workspaceId: input.discoveryWorkspaceId,
    message: input.discoveryWorkspaceId
      ? `workspace ${input.discoveryWorkspaceId}`
      : "workspace not resolved",
  };

  const probeInput = input.probe;
  const probePass = probeInput?.pass ?? 0;
  const probeFail = probeInput?.fail ?? 0;
  const probeUnknown = probeInput?.unknown ?? 0;
  const probe: DashboardProbeHealthCheck = {
    status: !probeInput?.reachable
      ? "unknown"
      : probeFail > 0
        ? "error"
        : probeUnknown > 0
          ? "warn"
          : "ok",
    url: probeInput?.url ?? "",
    reachable: probeInput?.reachable === true,
    pass: probePass,
    fail: probeFail,
    unknown: probeUnknown,
    message: !probeInput?.reachable
      ? "serve-probe offline"
      : `${probePass} pass · ${probeFail} fail · ${probeUnknown} unknown`,
  };

  const ok =
    agents.status !== "error" &&
    sse.status !== "error" &&
    herdr.status !== "error" &&
    gate.status !== "error" &&
    probe.status !== "error" &&
    discovery.status !== "error" &&
    agents.status !== "warn" &&
    discovery.status !== "warn";

  return {
    ok,
    checks: { agents, sse, herdr, gate, probe, discovery },
    fetchedAt,
  };
}

/** Probe serve-probe and build health input for `/api/health`. */
export async function fetchDashboardProbeHealthInput(
  projectPath: string
): Promise<NonNullable<DashboardHealthInput["probe"]>> {
  const cards = await fetchDashboardProbeCards(projectPath);
  if (!cards.reachable || !cards.summary) {
    return {
      url: cards.url,
      reachable: false,
      pass: 0,
      fail: 0,
      unknown: 0,
    };
  }
  return {
    url: cards.url,
    reachable: true,
    pass: cards.summary.pass,
    fail: cards.summary.fail,
    unknown: cards.summary.unknown,
  };
}

// ── Debug logs (curated error sinks — dashboard Logs tab) ────────────

export interface DashboardDebugLogSinkSummary {
  id: string;
  label: string;
  path: string;
  present: boolean;
  priority: "p1" | "p2";
  bytes?: number;
}

export interface DashboardDebugLogsSinksPayload {
  ok: boolean;
  sinks: DashboardDebugLogSinkSummary[];
  fetchedAt: string;
}

export interface DashboardDebugLogsTailPayload {
  ok: boolean;
  sink: string;
  path: string;
  lines: string[];
  totalLines: number;
  tail: number;
  fetchedAt: string;
  error?: string;
}

function toDebugLogSinkSummary(sink: ErrorLogSinkStatus): DashboardDebugLogSinkSummary {
  return {
    id: sink.id,
    label: sink.label,
    path: sink.path,
    present: sink.present,
    priority: dashboardLogSinkPriority(sink.id),
    ...(sink.bytes !== undefined ? { bytes: sink.bytes } : {}),
  };
}

/** Curated sink registry for the Logs tab (no wire.jsonl). */
export function fetchDashboardDebugLogSinks(projectPath: string): DashboardDebugLogsSinksPayload {
  const sinks = discoverDashboardLogSinks(projectPath).map(toDebugLogSinkSummary);
  return { ok: true, sinks, fetchedAt: new Date().toISOString() };
}

/** Tail lines from a curated debug log sink. */
export async function fetchDashboardDebugLogs(
  projectPath: string,
  sinkId: string,
  tail?: number
): Promise<DashboardDebugLogsTailPayload> {
  const fetchedAt = new Date().toISOString();
  const id = sinkId.trim();
  const limit = clampDashboardLogTail(tail);
  if (!id) {
    return {
      ok: false,
      sink: "",
      path: "",
      lines: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "sink required",
    };
  }

  if (!isDashboardCuratedLogSink(id)) {
    return {
      ok: false,
      sink: id,
      path: "",
      lines: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: `unknown or non-curated sink "${id}"`,
    };
  }

  const sink = discoverDashboardLogSinks(projectPath).find((row) => row.id === id);
  if (!sink) {
    return {
      ok: false,
      sink: id,
      path: "",
      lines: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: `unknown sink "${id}"`,
    };
  }

  if (!sink.present) {
    return {
      ok: false,
      sink: id,
      path: sink.path,
      lines: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "log file not found",
    };
  }

  if (sink.kind === "sqlite") {
    return {
      ok: false,
      sink: id,
      path: sink.path,
      lines: [],
      totalLines: 0,
      tail: limit,
      fetchedAt,
      error: "sqlite sinks are not tailable via this API",
    };
  }

  const { lines, totalLines } = await readErrorLogTail(sink.path, limit);
  return {
    ok: true,
    sink: id,
    path: sink.path,
    lines,
    totalLines,
    tail: limit,
    fetchedAt,
  };
}

export interface DashboardTlsCompliancePayload {
  ok: boolean;
  status: "pass" | "fail";
  reason?: string;
  floor: string;
  fetchedAt: string;
}

/** Live TLS minimum-version compliance status for the dashboard. */
export async function fetchDashboardTlsCompliance(): Promise<DashboardTlsCompliancePayload> {
  const floor = "TLSv1.2";
  const result = await tlsComplianceGate({ floor });
  return {
    ok: result.status === "pass",
    status: result.status,
    reason: result.reason,
    floor,
    fetchedAt: new Date().toISOString(),
  };
}
