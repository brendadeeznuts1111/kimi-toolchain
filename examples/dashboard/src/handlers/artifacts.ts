/**
 * Artifact identity APIs for the local examples dashboard.
 * Lightweight read-only endpoints aligned with Herdr dashboard filters.
 */
import {
  ArtifactStore,
  artifactFilterFromSessionRoute,
  extractArtifactTimestampMs,
  parseArtifactListQuery,
} from "../../../../src/lib/artifact-store.ts";
import {
  DASHBOARD_ARTIFACT_DIFF,
  DASHBOARD_ARTIFACT_FEED,
  DASHBOARD_ARTIFACT_INDEX_STATS,
  DASHBOARD_ARTIFACT_LINEAGE,
  DASHBOARD_RUN_MANIFEST,
  DASHBOARD_SESSION_ARTIFACTS,
  DASHBOARD_SESSION_RUNS,
  isDashboardArtifactNamespace,
  pathnameGroup,
} from "../../../../src/lib/dashboard-route-patterns.ts";
import {
  fetchDashboardArtifactContext,
  fetchDashboardArtifactDiff,
  fetchDashboardArtifactFeed,
  fetchDashboardArtifactIndexStats,
  fetchDashboardArtifactLineage,
  fetchDashboardArtifactMetadata,
  fetchDashboardGateGraph,
  fetchDashboardRunManifest,
  fetchDashboardRunsList,
  fetchDashboardSessionsIndex,
} from "../../../../src/lib/herdr-dashboard-data.ts";
import { resolveDashboardProjectRoot } from "../../../../src/lib/dashboard-settings.ts";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const ARTIFACT_READONLY_ERROR =
  "artifact API is read-only; run kimi-doctor --gate <name> --save-artifact to refresh gate artifacts";

export { resolveDashboardProjectRoot };

function artifactPayloadStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const row = payload as Record<string, unknown>;
  if (typeof row.status === "string") return row.status;
  if (typeof row.ok === "boolean") return row.ok ? "pass" : "fail";
  return "unknown";
}

function artifactPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "No payload summary";
  const row = payload as Record<string, unknown>;
  if (typeof row.message === "string") return row.message.slice(0, 160);
  if (typeof row.reason === "string") return row.reason.slice(0, 160);
  return JSON.stringify(payload).slice(0, 160);
}

async function fetchFilterOptions(projectPath: string) {
  const store = new ArtifactStore(projectPath);
  await store.syncIndexIfDrifted();
  return store.distinctIdentityFields();
}

type ArtifactRow = {
  gate: string;
  count: number;
  latestPath: string | null;
  latestAgeMs?: number;
  sessionId?: string;
  workspaceId?: string;
  paneId?: string;
  agentId?: string;
  runId?: string;
  status: string;
  summary: string;
  lineageSource?: "stored" | "declarative" | "runtime" | "none";
  dependencyCount?: number;
  upstreamArtifacts?: string[];
};

async function attachLineageSummaries(
  store: ArtifactStore,
  artifacts: ArtifactRow[]
): Promise<void> {
  for (const row of artifacts) {
    if (!row.latestPath || row.count === 0) {
      row.lineageSource = "none";
      row.dependencyCount = 0;
      row.upstreamArtifacts = [];
      continue;
    }
    const graph = await store.buildLineageGraph(row.latestPath);
    if (!graph) {
      row.lineageSource = "none";
      row.dependencyCount = 0;
      row.upstreamArtifacts = [];
      continue;
    }
    const declarativeCount = graph.resolved.reduce((sum, block) => sum + block.paths.length, 0);
    const runtimeCount = graph.runLineage?.upstreamArtifacts.length ?? 0;
    row.lineageSource = graph.lineageSource;
    row.dependencyCount = declarativeCount > 0 ? declarativeCount : runtimeCount;
    row.upstreamArtifacts = graph.runLineage?.upstreamArtifacts ?? [];
  }
}

async function fetchArtifacts(
  projectPath: string,
  filter = parseArtifactListQuery(new URLSearchParams()),
  options: { includeLineage?: boolean } = {}
) {
  const store = new ArtifactStore(projectPath);
  const gates = await store.listGates();
  const hasFilter = Boolean(
    filter.sessionId || filter.workspaceId || filter.paneId || filter.agentId || filter.runId
  );
  const artifacts: ArtifactRow[] = [];

  for (const gate of gates) {
    if (hasFilter) {
      const listed = await store.listEntries(gate, filter);
      if (listed.entries.length === 0) continue;
      const latestEntry = listed.entries.at(-1)!;
      const envelope = await store.readEnvelope(latestEntry.path);
      const latestTimestamp = extractArtifactTimestampMs(latestEntry.path);
      artifacts.push({
        gate,
        count: listed.entries.length,
        latestPath: latestEntry.path,
        ...(latestTimestamp !== null ? { latestAgeMs: Date.now() - latestTimestamp } : {}),
        ...(latestEntry.sessionId ? { sessionId: latestEntry.sessionId } : {}),
        ...(latestEntry.workspaceId ? { workspaceId: latestEntry.workspaceId } : {}),
        ...(latestEntry.paneId ? { paneId: latestEntry.paneId } : {}),
        ...(latestEntry.agentId ? { agentId: latestEntry.agentId } : {}),
        ...(latestEntry.runId ? { runId: latestEntry.runId } : {}),
        status: artifactPayloadStatus(envelope?.payload),
        summary: artifactPayloadSummary(envelope?.payload),
      });
      continue;
    }

    const paths = await store.list(gate);
    const latest = await store.getLatest(gate);
    const listed = await store.listEntries(gate, { limit: 1 });
    const latestEntry = listed.entries.at(-1);
    const latestTimestamp = latest?.relativePath
      ? extractArtifactTimestampMs(latest.relativePath)
      : null;
    artifacts.push({
      gate,
      count: paths.length,
      latestPath: latest?.relativePath ?? null,
      ...(latestTimestamp !== null ? { latestAgeMs: Date.now() - latestTimestamp } : {}),
      ...(latestEntry?.sessionId ? { sessionId: latestEntry.sessionId } : {}),
      ...(latestEntry?.workspaceId ? { workspaceId: latestEntry.workspaceId } : {}),
      ...(latestEntry?.paneId ? { paneId: latestEntry.paneId } : {}),
      ...(latestEntry?.agentId ? { agentId: latestEntry.agentId } : {}),
      ...(latestEntry?.runId ? { runId: latestEntry.runId } : {}),
      status: artifactPayloadStatus(latest?.payload),
      summary: artifactPayloadSummary(latest?.payload),
    });
  }

  if (options.includeLineage) {
    await attachLineageSummaries(store, artifacts);
  }

  return {
    ok: true,
    projectPath,
    artifacts,
    count: artifacts.length,
    gates: artifacts.map((row) => row.gate),
    ...(hasFilter ? { filter } : {}),
    ...(options.includeLineage ? { includeLineage: true } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

export async function handleArtifactsRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const root = resolveDashboardProjectRoot(import.meta.dir);
  const filter = parseArtifactListQuery(url.searchParams);

  if (path === "/api/artifacts" && req.method === "GET") {
    const includeLineage = url.searchParams.get("includeLineage") === "1";
    return jsonResponse(await fetchArtifacts(root, filter, { includeLineage }));
  }

  if (path === "/api/gates/graph" && req.method === "GET") {
    const gate = url.searchParams.get("gate")?.trim() || undefined;
    return jsonResponse(await fetchDashboardGateGraph(gate));
  }

  if (path === "/api/runs" && req.method === "GET") {
    return jsonResponse(await fetchDashboardRunsList(root, filter));
  }

  if (path === "/api/sessions" && req.method === "GET") {
    return jsonResponse(await fetchDashboardSessionsIndex(root));
  }

  const sessionRunsMatch = DASHBOARD_SESSION_RUNS.exec(url);
  if (sessionRunsMatch && req.method === "GET") {
    const scope = pathnameGroup(sessionRunsMatch, "scope");
    if (!scope) {
      return jsonResponse({ ok: false, error: "session scope required" }, 400);
    }
    const sessionFilter = artifactFilterFromSessionRoute(scope);
    return jsonResponse(await fetchDashboardRunsList(root, sessionFilter));
  }

  const sessionArtifactsMatch = DASHBOARD_SESSION_ARTIFACTS.exec(url);
  if (sessionArtifactsMatch && req.method === "GET") {
    const scope = pathnameGroup(sessionArtifactsMatch, "scope");
    if (!scope) {
      return jsonResponse({ ok: false, error: "session scope required" }, 400);
    }
    const sessionFilter = artifactFilterFromSessionRoute(scope);
    return jsonResponse(await fetchArtifacts(root, sessionFilter));
  }

  if (DASHBOARD_ARTIFACT_FEED.test(url) && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const xml = await fetchDashboardArtifactFeed(root, {
      baseUrl: url.origin,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (DASHBOARD_ARTIFACT_INDEX_STATS.test(url) && req.method === "GET") {
    return jsonResponse(await fetchDashboardArtifactIndexStats(root));
  }

  const diffMatch = DASHBOARD_ARTIFACT_DIFF.exec(url);
  if (diffMatch && req.method === "GET") {
    const gateName = pathnameGroup(diffMatch, "gate");
    const pathA = url.searchParams.get("a")?.trim() ?? "";
    const pathB = url.searchParams.get("b")?.trim() ?? "";
    if (!gateName || !pathA || !pathB) {
      return jsonResponse({ ok: false, error: "gate, a, and b query params required" }, 400);
    }
    const payload = await fetchDashboardArtifactDiff(root, gateName, pathA, pathB);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  const runMatch = DASHBOARD_RUN_MANIFEST.exec(url);
  if (runMatch && req.method === "GET") {
    const runId = pathnameGroup(runMatch, "runId");
    if (!runId) {
      return jsonResponse({ ok: false, error: "runId required" }, 400);
    }
    const payload = await fetchDashboardRunManifest(root, runId);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (path === "/api/artifacts/list" && req.method === "GET") {
    const gate = url.searchParams.get("gate") ?? "bunfig-policy";
    const store = new ArtifactStore(root);
    const listed = await store.listEntries(gate, filter);
    return jsonResponse({
      ok: true,
      gate,
      files: listed.files,
      entries: listed.entries,
      filter,
    });
  }

  if (path === "/api/artifacts/filter-options" && req.method === "GET") {
    return jsonResponse({ ok: true, filterOptions: await fetchFilterOptions(root) });
  }

  if (path === "/api/artifacts/metadata" && req.method === "GET") {
    const gate = url.searchParams.get("gate")?.trim() || undefined;
    return jsonResponse(await fetchDashboardArtifactMetadata(root, filter, { gate }));
  }

  if (path === "/api/artifacts/context" && req.method === "GET") {
    return jsonResponse(await fetchDashboardArtifactContext(root));
  }

  const lineageMatch = DASHBOARD_ARTIFACT_LINEAGE.exec(url);
  if (lineageMatch && req.method === "GET") {
    const gateName = pathnameGroup(lineageMatch, "gate");
    if (!gateName) {
      return jsonResponse({ ok: false, error: "gate required" }, 400);
    }
    const artifactPath = url.searchParams.get("path")?.trim() || undefined;
    const payload = await fetchDashboardArtifactLineage(root, gateName, artifactPath);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (isDashboardArtifactNamespace(path) && req.method !== "GET" && req.method !== "HEAD") {
    return jsonResponse({ ok: false, error: ARTIFACT_READONLY_ERROR }, 405);
  }

  return null;
}
