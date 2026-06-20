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
import { buildDashboardDeepLink, isBridgedCanvasManifest } from "./herdr-dashboard-bridge.ts";
import {
  clampDashboardLogTail,
  dashboardLogSinkPriority,
  discoverDashboardLogSinks,
  isDashboardCuratedLogSink,
  readErrorLogTail,
  type ErrorLogSinkStatus,
} from "./error-log-discovery.ts";
import { tlsComplianceGate } from "../guardian/tls-compliance.ts";
import { formatLogPreviewText } from "./log-preview.ts";
import {
  ArtifactStore,
  extractArtifactTimestampMs,
  parseArtifactDependencies,
  parseArtifactListQuery,
  type ArtifactDependencyQuery,
  type ArtifactListOptions,
  type ArtifactMetadata,
  type ArtifactRunLineage,
  type ArtifactRunManifest,
  type ArtifactMetadataCollectionEntry,
} from "./artifact-store.ts";
import {
  getDoctorRunsByRunId,
  getDoctorRunsBySession,
  type DoctorRunRecord,
} from "./doctor-runs.ts";

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
  /** Examples dashboard deep link when canvas supports reactive cards (v5.5 Herdr bridge) */
  dashboardDeepLink?: string;
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
    const canvasId =
      ref.canvasId ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", "");
    const entry: DashboardCanvasEntry = {
      id: ref.id,
      canvasId,
      page: ref.canvasPage ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", ""),
      path: ref.cursorCanvas,
      purpose: ref.purpose ?? "",
      version: ref.canvasVersion,
      layer: ref.canvasLayer,
      openWhen: ref.canvasOpenWhen,
      readOrder: ref.canvasReadOrder,
      influences: ref.canvasInfluences ? [...ref.canvasInfluences] : undefined,
    };
    if (isBridgedCanvasManifest(canvasId)) {
      entry.dashboardDeepLink = buildDashboardDeepLink({ manifestId: canvasId });
    }
    canvases.push(entry);
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
  /** Second-newest path for the gate (diff UI). */
  previousPath?: string | null;
  latestSize?: number;
  latestResultSize?: number;
  latestAgeMs?: number;
  source?: string;
  status: string;
  summary: string;
  preview?: string;
  updatedAt?: string | null;
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  runId?: string;
}

export interface DashboardArtifactFilterOptions {
  sessionIds: string[];
  workspaceIds: string[];
  paneIds: string[];
  agentIds: string[];
  runIds: string[];
}

export interface DashboardArtifactsPayload {
  ok: boolean;
  projectPath: string;
  probeServerUrl?: string;
  probeReachable?: boolean;
  artifacts: DashboardArtifactEntry[];
  filterOptions?: DashboardArtifactFilterOptions;
  filter?: ArtifactListOptions;
  fetchedAt: string;
}

export interface DashboardSessionsPayload {
  ok: boolean;
  projectPath: string;
  sessions: { kimi: string[]; herdr: string[] };
  fetchedAt: string;
}

export interface DashboardArtifactAggregatesPayload {
  ok: boolean;
  projectPath: string;
  aggregates: Array<{ gate: string; count: number; latestMs: number }>;
  filter?: ArtifactListOptions;
  fetchedAt: string;
}

export interface DashboardRunSummary {
  runId: string;
  status: ArtifactRunManifest["status"];
  startedAt: string;
  completedAt: string;
  gates: string[];
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  parentRunId?: string;
}

export interface DashboardRunsListPayload {
  ok: boolean;
  projectPath: string;
  runs: DashboardRunSummary[];
  filter?: ArtifactListOptions;
  fetchedAt: string;
}

/** Provenance fields shared across run detail, context graph, and metadata APIs. */
export interface DashboardArtifactMetadataFields {
  hostname?: string;
  pid?: number;
  bunVersion?: string;
  level?: 1 | 2 | 3;
  dependsOn?: ArtifactDependencyQuery[];
  lineage?: ArtifactRunLineage;
  hasLineageMermaid?: boolean;
}

export interface DashboardRunArtifactEntry extends DashboardArtifactMetadataFields {
  gate: string;
  path: string;
  /** True when path resolved via SQLite index rather than manifest map. */
  indexSource?: boolean;
  status: string;
  summary: string;
  savedAt: string | null;
  size?: number;
  resultSize?: number;
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  runId?: string;
  parentRunId?: string;
}

/** Normalize envelope metadata for dashboard JSON responses. */
export function dashboardEnvelopeMetadataFields(
  metadata: ArtifactMetadata | undefined
): DashboardArtifactMetadataFields {
  if (!metadata) return {};
  return {
    ...(typeof metadata.hostname === "string" && metadata.hostname.length > 0
      ? { hostname: metadata.hostname }
      : {}),
    ...(typeof metadata.pid === "number" && Number.isFinite(metadata.pid)
      ? { pid: metadata.pid }
      : {}),
    ...(typeof metadata.bunVersion === "string" && metadata.bunVersion.length > 0
      ? { bunVersion: metadata.bunVersion }
      : {}),
    ...(metadata.level !== undefined ? { level: metadata.level } : {}),
    ...(Array.isArray(metadata.dependsOn) && metadata.dependsOn.length > 0
      ? { dependsOn: metadata.dependsOn }
      : {}),
    ...(metadata.lineage &&
    (metadata.lineage.dependencies.length > 0 || metadata.lineage.upstreamArtifacts.length > 0)
      ? { lineage: metadata.lineage }
      : {}),
    ...(typeof metadata.lineageMermaid === "string" && metadata.lineageMermaid.length > 0
      ? { hasLineageMermaid: true }
      : {}),
  };
}

export interface DashboardArtifactMetadataPayload {
  ok: true;
  projectPath: string;
  entries: ArtifactMetadataCollectionEntry[];
  total: number;
  indexSource: "sqlite";
  filter: ArtifactListOptions;
  gate?: string;
  fetchedAt: string;
}

/** Indexed metadata collection for dashboard metadata panels. */
export async function fetchDashboardArtifactMetadata(
  projectPath: string,
  filter: ArtifactListOptions = parseArtifactListQuery(new URLSearchParams()),
  options: { gate?: string } = {}
): Promise<DashboardArtifactMetadataPayload> {
  const store = new ArtifactStore(projectPath);
  const payload = await store.collectMetadata(filter, options);
  return {
    ...payload,
    projectPath,
    filter,
    ...(options.gate ? { gate: options.gate } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

export interface DashboardRunManifestPayload {
  ok: boolean;
  projectPath: string;
  runId: string;
  manifest: ArtifactRunManifest;
  artifacts: DashboardRunArtifactEntry[];
  doctorRuns: DoctorRunRecord[];
  fetchedAt: string;
  error?: string;
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

function artifactPayloadPreview(payload: unknown): string {
  if (payload === undefined || payload === null) return "null";
  return JSON.stringify(payload, null, 2).slice(0, 1200);
}

const PROBE_FETCH_TIMEOUT_MS = 400;

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

function hasArtifactListFilter(filter: ArtifactListOptions): boolean {
  return Boolean(
    filter.sessionId ||
    filter.workspaceId ||
    filter.paneId ||
    filter.agentId ||
    filter.runId ||
    filter.parentRunId ||
    filter.since ||
    filter.until ||
    filter.limit ||
    filter.sessionIds?.length ||
    filter.workspaceIds?.length ||
    filter.paneIds?.length ||
    filter.agentIds?.length ||
    filter.runIds?.length ||
    filter.parentRunIds?.length ||
    filter.statuses?.length
  );
}

function artifactEntryIdentityFields(entry: {
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  runId?: string;
}): Pick<DashboardArtifactEntry, "sessionId" | "workspaceId" | "paneId" | "agentId" | "runId"> {
  return {
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(entry.paneId ? { paneId: entry.paneId } : {}),
    ...(entry.agentId ? { agentId: entry.agentId } : {}),
    ...(entry.runId ? { runId: entry.runId } : {}),
  };
}

/** Distinct identity values for artifact/run filter dropdowns. */
export async function fetchDashboardArtifactFilterOptions(
  projectPath: string
): Promise<DashboardArtifactFilterOptions> {
  const distinct = await new ArtifactStore(projectPath).distinctIdentityFields();
  return {
    sessionIds: distinct.sessionIds,
    workspaceIds: distinct.workspaceIds,
    paneIds: distinct.paneIds,
    agentIds: distinct.agentIds,
    runIds: distinct.runIds,
  };
}

/** Saved gate artifacts for the dashboard Artifacts tab. */
export async function fetchDashboardArtifacts(
  projectPath: string,
  filter: ArtifactListOptions = parseArtifactListQuery(new URLSearchParams())
): Promise<DashboardArtifactsPayload> {
  const { resolveProbeServerUrl } = await import("./doctor-probe-config.ts");
  const store = new ArtifactStore(projectPath);
  const probeServerUrl = await resolveProbeServerUrl(projectPath);
  const probeHealth = await fetchServeProbeJson(probeServerUrl, "/api/health");
  const gates = await store.listGates();
  const artifacts: DashboardArtifactEntry[] = [];
  const hasFilter = hasArtifactListFilter(filter);

  for (const gate of gates) {
    if (hasFilter) {
      const listed = await store.listEntries(gate, filter);
      if (listed.entries.length === 0) continue;
      const latestEntry = listed.entries.at(-1)!;
      const previousEntry = listed.entries.length >= 2 ? listed.entries.at(-2) : undefined;
      const envelope = await store.readEnvelope(latestEntry.path);
      const latestTimestamp = extractArtifactTimestampMs(latestEntry.path);
      artifacts.push({
        gate,
        count: listed.entries.length,
        latestPath: latestEntry.path,
        previousPath: previousEntry?.path ?? null,
        ...(latestEntry.size !== undefined ? { latestSize: latestEntry.size } : {}),
        ...(latestEntry.resultSize !== undefined
          ? { latestResultSize: latestEntry.resultSize }
          : {}),
        ...(latestTimestamp !== null ? { latestAgeMs: Date.now() - latestTimestamp } : {}),
        ...artifactEntryIdentityFields(latestEntry),
        status: artifactPayloadStatus(envelope?.payload),
        summary: artifactPayloadSummary(envelope?.payload),
      });
      continue;
    }

    const paths = await store.list(gate);
    const latest = await store.getLatest(gate);
    const listed = await store.listEntries(gate, { limit: 2 });
    const latestEntry = listed.entries.at(-1);
    const previousEntry = listed.entries.length >= 2 ? listed.entries.at(-2) : undefined;
    const latestTimestamp = latest?.relativePath
      ? extractArtifactTimestampMs(latest.relativePath)
      : null;
    artifacts.push({
      gate,
      count: paths.length,
      latestPath: latest?.relativePath ?? null,
      previousPath: previousEntry?.path ?? null,
      ...(latestEntry?.size !== undefined ? { latestSize: latestEntry.size } : {}),
      ...(latestEntry?.resultSize !== undefined
        ? { latestResultSize: latestEntry.resultSize }
        : {}),
      ...(latestTimestamp !== null ? { latestAgeMs: Date.now() - latestTimestamp } : {}),
      ...(latestEntry ? artifactEntryIdentityFields(latestEntry) : {}),
      source: "artifact-store",
      status: artifactPayloadStatus(latest?.payload),
      summary: artifactPayloadSummary(latest?.payload),
      preview: artifactPayloadPreview(latest?.payload),
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
    filterOptions: await fetchDashboardArtifactFilterOptions(projectPath),
    ...(hasFilter ? { filter } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

/** Kimi session ids and Herdr workspace ids discovered from saved artifacts. */
export async function fetchDashboardSessionsIndex(
  projectPath: string
): Promise<DashboardSessionsPayload> {
  const distinct = await new ArtifactStore(projectPath).distinctIdentityFields();
  return {
    ok: true,
    projectPath,
    sessions: {
      kimi: distinct.sessionIds,
      herdr: distinct.workspaceIds,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function artifactListOptionsToIndexQuery(
  options: ArtifactListOptions
): import("./artifact-index.ts").ArtifactIndexQuery {
  const query: import("./artifact-index.ts").ArtifactIndexQuery = {};
  if (options.since) query.since = options.since;
  if (options.until) query.until = options.until;

  const addSingle = (
    key: keyof import("./artifact-index.ts").ArtifactIndexQuery,
    value: string | undefined
  ): void => {
    if (!value) return;
    const arr = (query[key] as string[] | undefined) ?? [];
    if (!arr.includes(value)) arr.push(value);
    (query as Record<string, unknown>)[key] = arr;
  };

  addSingle("sessionIds", options.sessionId);
  addSingle("workspaceIds", options.workspaceId);
  addSingle("paneIds", options.paneId);
  addSingle("agentIds", options.agentId);
  addSingle("runIds", options.runId);
  addSingle("parentRunIds", options.parentRunId);

  const merge = (
    key: keyof import("./artifact-index.ts").ArtifactIndexQuery,
    values: string[] | undefined
  ): void => {
    if (!values || values.length === 0) return;
    const arr = ((query[key] as string[] | undefined) ?? []).slice();
    for (const value of values) {
      if (!arr.includes(value)) arr.push(value);
    }
    (query as Record<string, unknown>)[key] = arr;
  };

  merge("sessionIds", options.sessionIds);
  merge("workspaceIds", options.workspaceIds);
  merge("paneIds", options.paneIds);
  merge("agentIds", options.agentIds);
  merge("runIds", options.runIds);
  merge("parentRunIds", options.parentRunIds);
  merge("statuses", options.statuses);

  return query;
}

export interface DashboardArtifactIndexStatsPayload {
  ok: boolean;
  projectPath: string;
  stats: import("./artifact-store.ts").ArtifactIndexStats & { fsArtifactCount: number };
  synced: { rebuilt: boolean; fsCount: number; indexCount: number };
  fetchedAt: string;
}

export interface DashboardArtifactDiffPayload {
  ok: boolean;
  projectPath: string;
  gate: string;
  pathA: string;
  pathB: string;
  hashA: string | null;
  hashB: string | null;
  equal: boolean;
  statusA?: string;
  statusB?: string;
  runIdA?: string;
  runIdB?: string;
  indexSource: "sqlite";
  fetchedAt: string;
  error?: string;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface DashboardArtifactFeedOptions {
  limit?: number;
  baseUrl?: string;
}

/** RSS 2.0 feed of newest indexed artifacts (newest first). */
export async function fetchDashboardArtifactFeed(
  projectPath: string,
  options: DashboardArtifactFeedOptions = {}
): Promise<string> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1").replace(/\/$/, "");
  const store = new ArtifactStore(projectPath);
  await store.syncIndexIfDrifted();
  const rows = store.getIndex().find({ limit, order: "desc" });
  const builtAt = new Date().toUTCString();
  const channelTitle = escapeXmlText(`kimi-toolchain artifacts · ${projectPath}`);
  const items = rows
    .map((row) => {
      const status = row.status ?? "unknown";
      const title = escapeXmlText(`${row.gate} · ${status}`);
      const pubDate = new Date(row.savedAt).toUTCString();
      const lineageUrl = `${baseUrl}/api/artifacts/${encodeURIComponent(row.gate)}/lineage?path=${encodeURIComponent(row.relativePath)}`;
      const description = escapeXmlText(
        `${row.gate} artifact (${status}) saved ${row.savedAt}${row.runId ? ` · run ${row.runId}` : ""}`
      );
      return `    <item>
      <title>${title}</title>
      <link>${escapeXmlText(lineageUrl)}</link>
      <guid isPermaLink="false">${escapeXmlText(row.relativePath)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${channelTitle}</title>
    <link>${escapeXmlText(`${baseUrl}/api/artifacts/feed.xml`)}</link>
    <description>Saved gate artifacts from .kimi/artifacts (SQLite index)</description>
    <lastBuildDate>${builtAt}</lastBuildDate>
    <generator>kimi-toolchain herdr-dashboard</generator>
${items}
  </channel>
</rss>
`;
}

/** SQLite index health — filesystem vs index counts with drift repair. */
export async function fetchDashboardArtifactIndexStats(
  projectPath: string
): Promise<DashboardArtifactIndexStatsPayload> {
  const store = new ArtifactStore(projectPath);
  const synced = await store.syncIndexIfDrifted();
  return {
    ok: true,
    projectPath,
    stats: { ...store.getIndex().stats(), fsArtifactCount: synced.fsCount },
    synced,
    fetchedAt: new Date().toISOString(),
  };
}

/** Compare two saved artifacts by content hash (indexed metadata when available). */
export async function fetchDashboardArtifactDiff(
  projectPath: string,
  gateName: string,
  pathA: string,
  pathB: string
): Promise<DashboardArtifactDiffPayload> {
  const fetchedAt = new Date().toISOString();
  const store = new ArtifactStore(projectPath);
  const diff = await store.diffArtifactPaths(pathA.trim(), pathB.trim());
  if (!diff.ok) {
    return {
      ok: false,
      projectPath,
      gate: gateName,
      pathA,
      pathB,
      hashA: null,
      hashB: null,
      equal: false,
      indexSource: "sqlite",
      fetchedAt,
      error: diff.error,
    };
  }
  return {
    ok: true,
    projectPath,
    gate: gateName,
    pathA: diff.pathA,
    pathB: diff.pathB,
    hashA: diff.hashA,
    hashB: diff.hashB,
    equal: diff.equal,
    ...(diff.statusA ? { statusA: diff.statusA } : {}),
    ...(diff.statusB ? { statusB: diff.statusB } : {}),
    ...(diff.runIdA ? { runIdA: diff.runIdA } : {}),
    ...(diff.runIdB ? { runIdB: diff.runIdB } : {}),
    indexSource: "sqlite",
    fetchedAt,
  };
}

/** Per-gate artifact counts from the SQLite index (supports identity/status filters). */
export async function fetchDashboardArtifactAggregates(
  projectPath: string,
  filter: ArtifactListOptions = parseArtifactListQuery(new URLSearchParams())
): Promise<DashboardArtifactAggregatesPayload> {
  const store = new ArtifactStore(projectPath);
  await store.syncIndexIfDrifted();
  const aggregates = store.getIndex().countByGate(artifactListOptionsToIndexQuery(filter));
  const hasFilter = hasArtifactListFilter(filter);
  return {
    ok: true,
    projectPath,
    aggregates,
    ...(hasFilter ? { filter } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

function summarizeRunManifest(manifest: ArtifactRunManifest): DashboardRunSummary {
  return {
    runId: manifest.runId,
    status: manifest.status,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt,
    gates: manifest.gates,
    ...(manifest.sessionId ? { sessionId: manifest.sessionId } : {}),
    ...(manifest.workspaceId ? { workspaceId: manifest.workspaceId } : {}),
    ...(manifest.paneId ? { paneId: manifest.paneId } : {}),
    ...(manifest.agentId ? { agentId: manifest.agentId } : {}),
    ...(manifest.parentRunId ? { parentRunId: manifest.parentRunId } : {}),
  };
}

async function hydrateRunArtifacts(
  store: ArtifactStore,
  manifest: ArtifactRunManifest
): Promise<DashboardRunArtifactEntry[]> {
  const artifacts: DashboardRunArtifactEntry[] = [];
  const refs = await store.listRunArtifactRefs(manifest.runId, manifest);
  for (const ref of refs) {
    const relativePath = ref.relativePath;
    const envelope = await store.readEnvelope(relativePath);
    const metadata = envelope?.metadata;
    artifacts.push({
      gate: ref.gate,
      path: relativePath,
      indexSource: ref.indexSource,
      status: artifactPayloadStatus(envelope?.payload),
      summary: artifactPayloadSummary(envelope?.payload),
      savedAt: envelope?.savedAt ?? null,
      ...(envelope?.size !== undefined ? { size: envelope.size } : {}),
      ...(metadata?.resultSize !== undefined ? { resultSize: metadata.resultSize } : {}),
      ...(metadata?.sessionId ? { sessionId: metadata.sessionId } : {}),
      ...(metadata?.workspaceId ? { workspaceId: metadata.workspaceId } : {}),
      ...(metadata?.paneId ? { paneId: metadata.paneId } : {}),
      ...(metadata?.agentId ? { agentId: metadata.agentId } : {}),
      ...(metadata?.runId ? { runId: metadata.runId } : {}),
      ...(metadata?.parentRunId ? { parentRunId: metadata.parentRunId } : {}),
      ...dashboardEnvelopeMetadataFields(metadata),
    });
  }
  return artifacts;
}

/** Saved run manifests for the dashboard Runs tab (newest first). */
export async function fetchDashboardRunsList(
  projectPath: string,
  filter: ArtifactListOptions = {}
): Promise<DashboardRunsListPayload> {
  const store = new ArtifactStore(projectPath);
  const runs: DashboardRunSummary[] = [];
  for (const manifest of await store.listRunManifests(filter)) {
    runs.push(summarizeRunManifest(manifest));
  }
  const hasFilter = Boolean(
    filter.sessionId ||
    filter.workspaceId ||
    filter.paneId ||
    filter.agentId ||
    filter.runId ||
    filter.parentRunId
  );
  return {
    ok: true,
    projectPath,
    runs,
    ...(hasFilter ? { filter } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

/** Full run narrative: manifest plus hydrated artifact entries per gate. */
export async function fetchDashboardRunManifest(
  projectPath: string,
  runId: string
): Promise<DashboardRunManifestPayload> {
  const fetchedAt = new Date().toISOString();
  const store = new ArtifactStore(projectPath);
  const manifest = await store.readRunManifest(runId);
  if (!manifest) {
    return {
      ok: false,
      projectPath,
      runId,
      manifest: {
        schemaVersion: 1,
        runId,
        startedAt: "",
        completedAt: "",
        gates: [],
        artifacts: {},
        status: "fail",
      },
      artifacts: [],
      doctorRuns: [],
      fetchedAt,
      error: "Run not found",
    };
  }
  const doctorRuns = manifest.runId
    ? getDoctorRunsByRunId(manifest.runId)
    : manifest.sessionId
      ? getDoctorRunsBySession(manifest.sessionId)
      : [];
  return {
    ok: true,
    projectPath,
    runId,
    manifest,
    artifacts: await hydrateRunArtifacts(store, manifest),
    doctorRuns,
    fetchedAt,
  };
}

export interface DashboardArtifactLineagePayload {
  ok: boolean;
  projectPath: string;
  gate: string;
  path: string | null;
  mermaid: string | null;
  dependencyCount: number;
  stored: boolean;
  lineageSource: "stored" | "declarative" | "runtime" | "none";
  runLineage: { dependencies: string[]; upstreamArtifacts: string[] } | null;
  error?: string;
  fetchedAt: string;
}

/** Mermaid data-lineage for the newest artifact of a gate (or a specific path). */
export async function fetchDashboardArtifactLineage(
  projectPath: string,
  gateName: string,
  artifactPath?: string
): Promise<DashboardArtifactLineagePayload> {
  const fetchedAt = new Date().toISOString();
  const store = new ArtifactStore(projectPath);
  const relativePath =
    artifactPath?.trim() || (await store.getLatest(gateName))?.relativePath || null;

  if (!relativePath) {
    return {
      ok: false,
      projectPath,
      gate: gateName,
      path: null,
      mermaid: null,
      dependencyCount: 0,
      stored: false,
      lineageSource: "none",
      runLineage: null,
      error: `No artifacts found for gate: ${gateName}`,
      fetchedAt,
    };
  }

  const graph = await store.buildLineageGraph(relativePath);
  if (!graph) {
    return {
      ok: false,
      projectPath,
      gate: gateName,
      path: relativePath,
      mermaid: null,
      dependencyCount: 0,
      stored: false,
      lineageSource: "none",
      runLineage: null,
      error: `Artifact not found: ${relativePath}`,
      fetchedAt,
    };
  }

  const declarativeCount = graph.resolved.reduce((sum, block) => sum + block.paths.length, 0);
  const runtimeCount = graph.runLineage?.upstreamArtifacts.length ?? 0;
  const dependencyCount = declarativeCount > 0 ? declarativeCount : runtimeCount;
  return {
    ok: true,
    projectPath,
    gate: graph.gate,
    path: graph.relativePath,
    mermaid: graph.mermaid,
    dependencyCount,
    stored: graph.stored,
    lineageSource: graph.lineageSource,
    runLineage: graph.runLineage,
    fetchedAt,
  };
}

export interface DashboardArtifactContextNode extends DashboardArtifactMetadataFields {
  id: string;
  gate: string;
  path: string;
  timestamp: string | null;
  status: string;
  size?: number;
  resultSize?: number;
  upstream: string[];
}

export interface DashboardArtifactContextPayload {
  ok: boolean;
  projectPath: string;
  mermaid: string;
  total: number;
  gates: number;
  nodes: DashboardArtifactContextNode[];
  edges: Array<{ from: string; to: string }>;
  probeReachable: boolean;
  fetchedAt: string;
  error?: string;
}

/** Build a Mermaid id that is safe for node/class names. */
function mermaidNodeId(relativePath: string): string {
  const base = relativePath.replace(/\.kimi\/artifacts\//, "").replace(/\.json$/i, "");
  return "n_" + base.replace(/[^a-zA-Z0-9_]/g, "_");
}

function formatArtifactBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function compactArtifactName(relativePath: string): string {
  return relativePath.replace(/^\.kimi\/artifacts\//, "").replace(/\.json$/i, "");
}

/** Context graph: all saved artifacts as nodes with metadata and lineage edges. */
export async function fetchDashboardArtifactContext(
  projectPath: string
): Promise<DashboardArtifactContextPayload> {
  const fetchedAt = new Date().toISOString();
  const { resolveProbeServerUrl } = await import("./doctor-probe-config.ts");
  const store = new ArtifactStore(projectPath);
  const probeServerUrl = await resolveProbeServerUrl(projectPath);
  const probeHealth = await fetchServeProbeJson(probeServerUrl, "/api/health");

  const gates = await store.listGates();
  const nodes: DashboardArtifactContextNode[] = [];
  const pathToId = new Map<string, string>();
  const edges: Array<{ from: string; to: string }> = [];

  for (const gate of gates) {
    const entries = await store.listEntries(gate);
    for (const entry of entries.entries) {
      const envelope = await store.readEnvelope(entry.path);
      const payload = envelope?.payload;
      const metadata = envelope?.metadata;
      const status = artifactPayloadStatus(payload);
      const upstream = new Set<string>();
      if (metadata?.lineage && Array.isArray(metadata.lineage.upstreamArtifacts)) {
        for (const path of metadata.lineage.upstreamArtifacts) upstream.add(path);
      }
      const dependsOn = parseArtifactDependencies(metadata);
      if (dependsOn.length > 0) {
        const resolved = await store.resolveDependsOn(dependsOn);
        for (const block of resolved) {
          for (const path of block.paths) upstream.add(path);
        }
      }
      const node: DashboardArtifactContextNode = {
        id: mermaidNodeId(entry.path),
        gate,
        path: entry.path,
        timestamp: entry.timestamp,
        status,
        ...(entry.size !== undefined ? { size: entry.size } : {}),
        ...(entry.resultSize !== undefined ? { resultSize: entry.resultSize } : {}),
        ...dashboardEnvelopeMetadataFields(metadata),
        upstream: [...upstream],
      };
      nodes.push(node);
      pathToId.set(entry.path, node.id);
    }
  }

  for (const node of nodes) {
    for (const upstreamPath of node.upstream) {
      const from = pathToId.get(upstreamPath);
      if (from) edges.push({ from, to: node.id });
    }
  }

  const lines: string[] = ["flowchart TD"];
  for (const gate of gates) {
    const gateNodes = nodes.filter((n) => n.gate === gate);
    if (gateNodes.length === 0) continue;
    const safeGate = gate.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`  subgraph sg_${safeGate}["${gate}"]`);
    for (const node of gateNodes) {
      const name = compactArtifactName(node.path);
      const label = [
        `${name}`,
        `status: ${node.status}`,
        `size: ${formatArtifactBytes(node.size)}`,
        `result: ${formatArtifactBytes(node.resultSize)}`,
        node.timestamp ? `saved: ${node.timestamp.replace("T", " ").slice(0, 19)}` : "",
      ]
        .filter(Boolean)
        .join("<br>");
      lines.push(`    ${node.id}["${label}"]`);
    }
    lines.push("  end");
  }

  for (const edge of edges) {
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }

  const totalArtifacts = nodes.length;
  const contextLabel = [
    `artifacts: ${totalArtifacts}`,
    `gates: ${gates.length}`,
    `edges: ${edges.length}`,
    `probe: ${probeHealth.ok ? "reachable" : "offline"}`,
  ].join("<br>");
  lines.push(`  ctx[["${contextLabel}"]]`);

  return {
    ok: true,
    projectPath,
    mermaid: lines.join("\n"),
    total: totalArtifacts,
    gates: gates.length,
    nodes,
    edges,
    probeReachable: probeHealth.ok,
    fetchedAt,
  };
}

export interface DashboardGateGraphPayload {
  ok: boolean;
  gate: string | null;
  mermaid: string;
  gates: Array<{ name: string; dependsOn: string[] }>;
  fetchedAt: string;
}

/** Static gate execution DAG as Mermaid (no subprocess). */
export async function fetchDashboardGateGraph(
  gateName?: string
): Promise<DashboardGateGraphPayload> {
  const { generateGateGraph } = await import("../gates/runner.ts");
  const { getGate, listBuiltinGateDefinitions, resolveGateClosure } =
    await import("../gates/registry.ts");

  let gates = listBuiltinGateDefinitions();
  let gate: string | null = null;

  if (gateName) {
    if (!getGate(gateName)) {
      return {
        ok: false,
        gate: gateName,
        mermaid: `graph TD\n  missing["unknown gate: ${gateName}"]`,
        gates: [],
        fetchedAt: new Date().toISOString(),
      };
    }
    const closure = resolveGateClosure(gateName);
    gates = closure.gates;
    gate = gateName;
  }

  return {
    ok: true,
    gate,
    mermaid: generateGateGraph(gates),
    gates: gates.map((g) => ({ name: g.name, dependsOn: g.dependsOn ?? [] })),
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
  entries: DashboardDebugLogEntry[];
  totalLines: number;
  tail: number;
  fetchedAt: string;
  error?: string;
}

export interface DashboardDebugLogEntry {
  lineNumber: number;
  severity: "error" | "warn" | "info";
  message: string;
  raw: string;
  /** Width-aware preview for log cards (stripANSI + stringWidth truncation). */
  preview: string;
  timestamp?: string;
  source?: string;
  tool?: string;
  taxonomyId?: string;
  category?: string;
  sessionId?: string;
  errorId?: string;
  tags?: string[];
  payloadKeys?: string[];
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

function parseDashboardDebugLogJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function dashboardDebugLogSeverity(
  line: string,
  parsed: Record<string, unknown> | null = parseDashboardDebugLogJson(line)
): DashboardDebugLogEntry["severity"] {
  const parsedSeverity = typeof parsed?.severity === "string" ? parsed.severity.toLowerCase() : "";
  if (parsedSeverity === "error" || parsedSeverity === "warn" || parsedSeverity === "info") {
    return parsedSeverity;
  }
  if (/\b(error|fail(?:ed|ure)?|exception|panic|fatal|✗|✘)\b/i.test(line)) return "error";
  if (/\b(warn(?:ing)?)\b/i.test(line)) return "warn";
  return "info";
}

function firstUsefulLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? value.trim()
  );
}

function dashboardDebugLogMessage(
  line: string,
  parsed: Record<string, unknown> | null = parseDashboardDebugLogJson(line)
): string {
  const trimmed = line.trim();
  if (parsed) {
    for (const key of ["message", "msg", "error", "output", "suggestion"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return firstUsefulLine(value);
    }
  }
  return trimmed
    .replace(/^\[?\d{4}-\d{2}-\d{2}[^\]\s]*(?:\s+|]\s*)/, "")
    .replace(/^\[?(?:error|warn(?:ing)?|info|debug)\]?\s*[:|-]?\s*/i, "")
    .trim();
}

function dashboardDebugLogTags(
  sinkId: string,
  parsed: Record<string, unknown> | null,
  severity: DashboardDebugLogEntry["severity"]
): string[] {
  const tags = new Set<string>([`sink:${sinkId}`, `severity:${severity}`]);
  const add = (prefix: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) tags.add(`${prefix}:${value.trim()}`);
  };
  add("tool", parsed?.toolName);
  add("taxonomy", parsed?.taxonomyId);
  add("category", parsed?.categoryId);
  add("session", parsed?.sessionId);
  return [...tags].slice(0, 8);
}

function dashboardDebugLogEntries(
  lines: string[],
  totalLines: number,
  sinkId: string
): DashboardDebugLogEntry[] {
  const firstLine = Math.max(1, totalLines - lines.length + 1);
  return lines.map((line, index) => {
    const parsed = parseDashboardDebugLogJson(line);
    const severity = dashboardDebugLogSeverity(line, parsed);
    const message = dashboardDebugLogMessage(line, parsed);
    const tool = typeof parsed?.toolName === "string" ? parsed.toolName : undefined;
    const taxonomyId = typeof parsed?.taxonomyId === "string" ? parsed.taxonomyId : undefined;
    const category =
      typeof parsed?.categoryName === "string"
        ? parsed.categoryName
        : typeof parsed?.categoryId === "string"
          ? parsed.categoryId
          : undefined;
    return {
      lineNumber: firstLine + index,
      severity,
      message,
      raw: line,
      preview: formatLogPreviewText(message || line),
      ...(typeof parsed?.timestamp === "string" ? { timestamp: parsed.timestamp } : {}),
      source: sinkId,
      ...(tool ? { tool } : {}),
      ...(taxonomyId ? { taxonomyId } : {}),
      ...(category ? { category } : {}),
      ...(typeof parsed?.sessionId === "string" ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed?.errorId === "string" ? { errorId: parsed.errorId } : {}),
      tags: dashboardDebugLogTags(sinkId, parsed, severity),
      payloadKeys: parsed ? Object.keys(parsed).slice(0, 12) : [],
    };
  });
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
      entries: [],
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
      entries: [],
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
      entries: [],
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
      entries: [],
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
      entries: [],
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
    entries: dashboardDebugLogEntries(lines, totalLines, id),
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
