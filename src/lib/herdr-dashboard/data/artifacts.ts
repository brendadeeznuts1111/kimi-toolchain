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
} from "../../artifact-store.ts";
import {
  getDoctorRunsByRunId,
  getDoctorRunsBySession,
  type DoctorRunRecord,
} from "../../doctor-runs.ts";
import type { ArtifactGraphConvergenceBlock } from "../../artifact-graph-convergence.ts";

export type { ConvergenceProbeStatus } from "../../artifact-graph-convergence.ts";

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
  summary?: { pass: number; fail: number; skip: number; total: number };
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

async function resolveProbeServerHealth(
  projectPath: string,
  path: string
): Promise<{ url: string; health: { ok: boolean; status: number; body: unknown } }> {
  try {
    const { resolveProbeServerUrl } = await import("../../doctor-probe-config.ts");
    const url = await resolveProbeServerUrl(projectPath);
    const health = await fetchServeProbeJson(url, path);
    return { url, health };
  } catch {
    return { url: "", health: { ok: false, status: 0, body: null } };
  }
}

/** Proxy serve-probe card snapshot for dashboard summary card. */
export async function fetchDashboardProbeCards(
  projectPath: string
): Promise<DashboardProbeCardsPayload> {
  const { url, health: result } = await resolveProbeServerHealth(projectPath, "/api/cards");
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
  const store = new ArtifactStore(projectPath);
  const { url: probeServerUrl, health: probeHealth } = await resolveProbeServerHealth(
    projectPath,
    "/api/health"
  );
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
): import("../../artifact-index.ts").ArtifactIndexQuery {
  const query: import("../../artifact-index.ts").ArtifactIndexQuery = {};
  if (options.since) query.since = options.since;
  if (options.until) query.until = options.until;

  const addSingle = (
    key: keyof import("../../artifact-index.ts").ArtifactIndexQuery,
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
    key: keyof import("../../artifact-index.ts").ArtifactIndexQuery,
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
  stats: import("../../artifact-store.ts").ArtifactIndexStats & { fsArtifactCount: number };
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

export type DashboardArtifactGraphConvergence = ArtifactGraphConvergenceBlock;

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
  convergence?: DashboardArtifactGraphConvergence;
  error?: string;
}

export interface DashboardArtifactGraphPayload {
  ok: boolean;
  projectPath: string;
  context: DashboardArtifactContextPayload;
  gateGraph: DashboardGateGraphPayload;
  convergence: DashboardArtifactGraphConvergence;
  artifactGraph: {
    aligned: boolean;
    gateCount: number;
    artifactCount: number;
    edgeCount: number;
    inspectCommand: string;
  };
  fetchedAt: string;
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
  projectPath: string,
  options: { includeConvergence?: boolean } = {}
): Promise<DashboardArtifactContextPayload> {
  const includeConvergence = options.includeConvergence ?? true;
  const fetchedAt = new Date().toISOString();
  const store = new ArtifactStore(projectPath);
  const { health: probeHealth } = await resolveProbeServerHealth(projectPath, "/api/health");

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

  const convergence = includeConvergence
    ? await (async () => {
        const { buildArtifactGraphConvergenceBlock } =
          await import("../../artifact-graph-convergence.ts");
        return buildArtifactGraphConvergenceBlock(projectPath);
      })()
    : undefined;

  return {
    ok: true,
    projectPath,
    mermaid: lines.join("\n"),
    total: totalArtifacts,
    gates: gates.length,
    nodes,
    edges,
    probeReachable: probeHealth.ok,
    ...(convergence ? { convergence } : {}),
    fetchedAt,
  };
}

/** Combined artifact context + execution DAG + runtime/Bun.Image convergence. */
export async function fetchDashboardArtifactGraph(
  projectPath: string
): Promise<DashboardArtifactGraphPayload> {
  const { auditArtifactGraphHealth } = await import("../../artifact-graph-health.ts");
  const { buildArtifactGraphConvergenceBlock } =
    await import("../../artifact-graph-convergence.ts");
  const [context, gateGraph, graphHealth, convergence] = await Promise.all([
    fetchDashboardArtifactContext(projectPath, { includeConvergence: false }),
    fetchDashboardGateGraph(),
    auditArtifactGraphHealth(projectPath),
    buildArtifactGraphConvergenceBlock(projectPath),
  ]);

  return {
    ok: context.ok && gateGraph.ok && convergence.aligned,
    projectPath,
    context,
    gateGraph,
    convergence,
    artifactGraph: {
      aligned: graphHealth.aligned,
      gateCount: graphHealth.gateCount,
      artifactCount: graphHealth.artifactCount,
      edgeCount: graphHealth.edgeCount,
      inspectCommand: graphHealth.inspectCommand,
    },
    fetchedAt: new Date().toISOString(),
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
  const { generateGateGraph } = await import("../../../gates/runner.ts");
  const { getGate, listBuiltinGateDefinitions, resolveGateClosure } =
    await import("../../../gates/registry.ts");

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
