/**
 * Dashboard HTTP route dispatch — composable handler for Bun.serve fetch.
 */

import {
  bunImageSupported,
  dashboardThumbnailFeedsActive,
  dashboardThumbnailBytes,
  DASHBOARD_THUMB_HEIGHT,
  DASHBOARD_THUMB_WIDTH,
  negotiateDashboardThumbnailFormat,
  probeBunImageAvifEncode,
  thumbnailCacheKey,
  thumbnailFormatMime,
  type DashboardThumbnailFormat,
} from "../../bun-image.ts";
import { bunRevision, bunVersion } from "../../bun-utils.ts";
import { inspectAgent } from "../../inspect.ts";
import { loadDxDefaults } from "../../defaults-config.ts";
import {
  fetchDashboardCanvases,
  fetchDashboardHandoffs,
  fetchDashboardRules,
  fetchDashboardUpgradeScan,
  runDashboardAgentAction,
  runDashboardIpcCommand,
  runDashboardScanFix,
  fetchDashboardDebugLogSinks,
  fetchDashboardDebugLogs,
  fetchDashboardGateHealth,
  fetchDashboardHealth,
  fetchDashboardMetrics,
  fetchDashboardTlsCompliance,
  fetchDashboardArtifacts,
  fetchDashboardArtifactAggregates,
  fetchDashboardArtifactFeed,
  fetchDashboardArtifactIndexStats,
  fetchDashboardArtifactDiff,
  fetchDashboardRunsList,
  fetchDashboardRunManifest,
  fetchDashboardSessionsIndex,
  fetchDashboardArtifactLineage,
  fetchDashboardArtifactContext,
  fetchDashboardArtifactGraph,
  fetchDashboardArtifactMetadata,
  fetchDashboardGateGraph,
  fetchDashboardProbeCards,
  fetchDashboardProbeHealthInput,
  type DashboardActionRequest,
  type DashboardIpcCommand,
} from "../data/data.ts";
import {
  buildHerdrDashboardEffectImageMeta,
  effectImageMarkBytes,
  effectImageMarkMime,
  EFFECT_IMAGE_MARK_HEIGHT,
  EFFECT_IMAGE_MARK_WIDTH,
} from "../effect-image.ts";
import { artifactFilterFromSessionRoute, parseArtifactListQuery } from "../../artifact-store.ts";
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
} from "../../dashboard-route-patterns.ts";
import { TtlCache } from "../../cache.ts";
import {
  dashboardEventTimestamp,
  writeDashboardEvent,
  queryDashboardEvents,
  exportEventsToMarkdown,
} from "../../dashboard-audit-store.ts";
import {
  buildDashboardWidgetCacheKey,
  fetchDashboardWidget,
  isDashboardWidgetId,
  PROCESSES_WIDGET_WORKSPACE_SCOPE,
  type DashboardWidgetResponse,
} from "../widgets/widgets.ts";
import {
  runDashboardPaneAction,
  type DashboardPaneActionRequest,
} from "../widgets/processes-action.ts";
import {
  bunHttp3ServeSupported,
  dashboardHttp3Requested,
  type DashboardServeTransport,
} from "./http3.ts";
import { fetchExamplesDashboardHealth } from "../../examples-dashboard-companion.ts";
import type { HerdrDashboardServerOptions } from "../types.ts";
import type { HerdrDashboardHub } from "./hub.ts";
import type { DashboardHerdrEventBridgeHandle } from "./events.ts";
import type { DashboardGateHealthWatchHandle } from "../gates/gate-watch.ts";
import type { DashboardMetaWebView } from "../webview/store.ts";
import {
  dashboardAssetResponse,
  dashboardHtml,
  dashboardScreenshotPlaceholder,
  withCorsHeaders,
} from "./assets.ts";

interface ServeRequest {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

async function readJsonBody<T>(request: ServeRequest): Promise<T | null> {
  try {
    const raw = await request.text();
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(`${inspectAgent(body)}\n`, {
    status,
    headers: withCorsHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
}

export interface DashboardRouteContext {
  options: HerdrDashboardServerOptions;
  hub: HerdrDashboardHub;
  herdrEventBridge: DashboardHerdrEventBridgeHandle;
  gateHealthWatch: DashboardGateHealthWatchHandle | null;
  pollHintMs: number;
  ssePollMs: number;
  staleMs: number;
  examplesDashboardUrl: string;
  screenshotPng: { current: Uint8Array | null };
  widgetCache: TtlCache<DashboardWidgetResponse>;
  thumbnailCache: TtlCache<Uint8Array>;
  metaWebView: DashboardMetaWebView;
  scheme: string;
  transport: DashboardServeTransport;
}

export async function handleDashboardRequest(
  req: Request,
  ctx: DashboardRouteContext
): Promise<Response> {
  const {
    options,
    hub,
    herdrEventBridge,
    gateHealthWatch,
    pollHintMs,
    ssePollMs,
    staleMs,
    examplesDashboardUrl,
    widgetCache,
    thumbnailCache,
    metaWebView,
    scheme,
    transport,
  } = ctx;

  const request = req as unknown as ServeRequest;
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS" && path.startsWith("/api/")) {
    return new Response(null, {
      status: 204,
      headers: withCorsHeaders({ "cache-control": "no-store" }),
    });
  }

  if (path === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  if (path === "/" || path === "/index.html") {
    return new Response(dashboardHtml(), {
      headers: withCorsHeaders({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      }),
    });
  }

  if (path === "/herdr-dashboard.css" || path === "/herdr-dashboard.js") {
    const name = path.slice(1);
    return dashboardAssetResponse(name);
  }

  const { resolveProbeServerUrl } = await import("../../doctor-probe-config.ts");
  const probeServerUrl = await resolveProbeServerUrl(options.projectPath);

  if (path === "/api/meta") {
    const dxDefaults = await loadDxDefaults(options.projectPath);
    const effectImage = await buildHerdrDashboardEffectImageMeta();
    const meta: Record<string, unknown> = {
      ok: true,
      projectPath: options.projectPath,
      pollHintMs,
      ssePollMs,
      sse: true,
      staleMs,
      examplesDashboardUrl,
      probeServerUrl,
      cache: hub.cacheStats(),
      herdrEvents: herdrEventBridge.status(),
      webview: metaWebView,
      discovery: hub.discoveryCache.discoveryContext(),
      bunMarkPath: effectImage.markPath,
      effectImage,
      defaults: dxDefaults ?? undefined,
      dryRun: options.dryRun ?? false,
      thumbnail:
        bunImageSupported() &&
        dashboardThumbnailFeedsActive({
          shell: metaWebView.shell,
          screenshotProvider: options.screenshotProvider,
          hasScreenshot: Boolean(ctx.screenshotPng.current),
        }),
      thumbnailPath: "/api/thumbnail",
      thumbnailFormats: bunImageSupported()
        ? {
            webp: true,
            avif: await probeBunImageAvifEncode(),
          }
        : undefined,
      transport: {
        scheme,
        tls: transport.tls,
        http3: transport.http3,
        http3Supported: bunHttp3ServeSupported(),
        http3Requested: dashboardHttp3Requested(options.http3),
        fallbackReason: transport.fallbackReason,
      },
      runtime: {
        bunVersion: bunVersion(),
        bunRevision: bunRevision(),
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      },
      bunRuntimeCapabilities: await (async () => {
        const { auditRuntimeCapabilitiesHealth } = await import("../../bun-install-config.ts");
        const health = await auditRuntimeCapabilitiesHealth(options.projectPath);
        if (!health.applicable) return null;
        return {
          aligned: health.aligned,
          capabilityCount: health.capabilityCount,
          inspectCommand: health.inspectCommand,
          sourceModule: health.sourceModule,
          runtimeApiDocs: health.runtimeApiDocs,
          fixPlan: health.fixPlan,
        };
      })(),
    };
    if (ctx.screenshotPng.current) {
      const placeholder = await dashboardScreenshotPlaceholder(ctx.screenshotPng.current);
      if (placeholder) meta.placeholder = placeholder;
    }
    return jsonResponse(meta);
  }

  if (path === "/api/examples/health") {
    const payload = await fetchExamplesDashboardHealth(examplesDashboardUrl);
    return jsonResponse(payload);
  }

  if (path === "/api/probe/cards" && request.method === "GET") {
    const payload = await fetchDashboardProbeCards(options.projectPath);
    return jsonResponse(payload, payload.reachable ? 200 : 503);
  }

  if (path === "/api/bun-mark") {
    if (!bunImageSupported()) {
      return jsonResponse({ ok: false, error: "Bun.Image unavailable" }, 503);
    }
    const width = Number(url.searchParams.get("width") || String(EFFECT_IMAGE_MARK_WIDTH));
    const height = Number(url.searchParams.get("height") || String(EFFECT_IMAGE_MARK_HEIGHT));
    const quality = Number(url.searchParams.get("quality") || "82");
    const bytes = await effectImageMarkBytes({ width, height, quality });
    if (!bytes) {
      return jsonResponse({ ok: false, error: "bun mark encode failed" }, 500);
    }
    return new Response(bytes as BodyInit, {
      headers: withCorsHeaders({
        "content-type": effectImageMarkMime(),
        "cache-control": "no-store",
      }),
    });
  }

  if (path === "/api/effect-image") {
    return jsonResponse(await buildHerdrDashboardEffectImageMeta());
  }

  if (path === "/api/thumbnail") {
    if (!bunImageSupported()) {
      return jsonResponse({ ok: false, error: "Bun.Image unavailable" }, 503);
    }
    const png =
      ctx.screenshotPng.current ??
      (options.screenshotProvider ? await options.screenshotProvider() : null);
    if (!png) {
      return jsonResponse({ ok: false, error: "no screenshot available" }, 404);
    }
    const width = Number(url.searchParams.get("width") || String(DASHBOARD_THUMB_WIDTH));
    const height = Number(url.searchParams.get("height") || String(DASHBOARD_THUMB_HEIGHT));
    const quality = Number(url.searchParams.get("quality") || "80");
    const formatParam = url.searchParams.get("format") as DashboardThumbnailFormat | null;
    const format: DashboardThumbnailFormat =
      formatParam && ["webp", "avif", "jpeg", "png"].includes(formatParam)
        ? formatParam
        : negotiateDashboardThumbnailFormat(request.headers.get("accept"));

    const cacheKey = thumbnailCacheKey(png, width, height, quality, format);
    const cached = thumbnailCache.get(cacheKey);
    if (cached) {
      return new Response(cached as BodyInit, {
        headers: withCorsHeaders({
          "content-type": thumbnailFormatMime(format),
          "cache-control": "no-store",
          "x-thumbnail-cache": "hit",
        }),
      });
    }

    try {
      const bytes = await dashboardThumbnailBytes(png, { width, height, quality, format });
      if (!bytes) {
        return jsonResponse({ ok: false, error: "thumbnail encode failed" }, 500);
      }
      thumbnailCache.set(cacheKey, bytes);
      return new Response(bytes as BodyInit, {
        headers: withCorsHeaders({
          "content-type": thumbnailFormatMime(format),
          "cache-control": "no-store",
          "x-thumbnail-cache": "miss",
        }),
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : Bun.inspect(e);
      return jsonResponse({ ok: false, error: message }, 500);
    }
  }

  if (path === "/api/agents") {
    const cached = hub.lastPayload;
    setTimeout(() => void hub.refreshDiscovery(), 0);
    if (cached) {
      return jsonResponse(cached, cached.ok ? 200 : 503);
    }
    return jsonResponse({
      ok: true,
      projectPath: options.projectPath,
      agentCount: 0,
      agents: [],
      fetchedAt: new Date().toISOString(),
      warming: true,
    });
  }

  if (path === "/api/agents/live") {
    return new Response(hub.createAgentsLiveStream(), {
      headers: withCorsHeaders({
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      }),
    });
  }

  if (path === "/api/heartbeat" && request.method === "POST") {
    const body = await readJsonBody<{
      agent?: string;
      host?: string;
      session?: string;
    }>(request);
    if (!body?.agent) {
      return jsonResponse({ ok: false, error: "agent required" }, 400);
    }
    hub.recordHeartbeat(body.agent, body.host, body.session);
    return jsonResponse({ ok: true, agent: body.agent });
  }

  if (path === "/api/heartbeats" && request.method === "POST") {
    const body = await readJsonBody<{
      agents?: Array<{ agent?: string; host?: string; session?: string }>;
    }>(request);
    const rows = body?.agents ?? [];
    if (rows.length === 0) {
      return jsonResponse({ ok: false, error: "agents array required" }, 400);
    }
    const recorded = hub.recordHeartbeats(
      rows.filter((row): row is { agent: string; host?: string; session?: string } =>
        Boolean(row?.agent)
      )
    );
    if (recorded === 0) {
      return jsonResponse({ ok: false, error: "no valid agents" }, 400);
    }
    return jsonResponse({ ok: true, recorded });
  }

  if (path === "/api/handoffs") {
    const limit = Number(url.searchParams.get("limit") || "50");
    return jsonResponse(await fetchDashboardHandoffs(options.projectPath, limit));
  }

  if (path === "/api/rules") {
    return jsonResponse(await fetchDashboardRules(options.projectPath, options.dryRun ?? false));
  }

  if (path === "/api/scan") {
    const payload = await fetchDashboardUpgradeScan(options.projectPath);
    return jsonResponse(payload);
  }

  if (path === "/api/scan/fix" && request.method === "POST") {
    const body = await readJsonBody<{
      ruleId?: string;
      file?: string;
      line?: number;
    }>(request);
    if (!body?.ruleId || !body.file || typeof body.line !== "number") {
      return jsonResponse({ ok: false, error: "ruleId, file, and line required" }, 400);
    }
    const result = await runDashboardScanFix(options.projectPath, {
      ruleId: body.ruleId,
      file: body.file,
      line: body.line,
    });
    if (result.ok) {
      writeDashboardEvent({
        type: "scan.fix",
        workspace: herdrEventBridge.status().workspaceId ?? undefined,
        payload: {
          ruleId: result.ruleId,
          file: result.file,
          diff: result.diff,
          message: result.message,
        },
        at: dashboardEventTimestamp(),
      });
    }
    return jsonResponse(result, result.ok ? 200 : 422);
  }

  if (path === "/api/events") {
    const typeParam = url.searchParams.get("type") ?? undefined;
    const workspace = url.searchParams.get("workspace") ?? undefined;
    const agent = url.searchParams.get("agent") ?? undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const q =
      url.searchParams.get("q") ??
      url.searchParams.get("query") ??
      url.searchParams.get("text") ??
      undefined;
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    return jsonResponse(
      queryDashboardEvents({ type: typeParam, workspace, agent, severity, q, since, limit })
    );
  }

  if (path === "/api/events/types") {
    const result = queryDashboardEvents({ limit: 1 });
    return jsonResponse({ ok: true, types: result.types });
  }

  if (path === "/api/events/export") {
    const format = url.searchParams.get("format") ?? "markdown";
    const typeParam = url.searchParams.get("type") ?? undefined;
    const workspace = url.searchParams.get("workspace") ?? undefined;
    const agent = url.searchParams.get("agent") ?? undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const q =
      url.searchParams.get("q") ??
      url.searchParams.get("query") ??
      url.searchParams.get("text") ??
      undefined;
    const result = queryDashboardEvents({
      type: typeParam,
      workspace,
      agent,
      severity,
      q,
      limit: 200,
    });
    if (format === "json") {
      return jsonResponse(result);
    }
    const md = exportEventsToMarkdown(result.events);
    return new Response(md, {
      headers: withCorsHeaders({
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
      }),
    });
  }

  if (path === "/api/canvases") {
    const { parseDashboardCompanionQuery } = await import("./bridge.ts");
    const companion = parseDashboardCompanionQuery(url.searchParams);
    const payload = await fetchDashboardCanvases({
      projectPath: options.projectPath,
      companion,
    });
    return jsonResponse(payload);
  }

  if (path === "/api/canvas-filter" && request.method === "GET") {
    const { applyCanvasFilter } = await import("../../dashboard-canvas-filter.ts");
    const result = await applyCanvasFilter(options.projectPath, url);
    return jsonResponse({
      ok: true,
      ...result,
      fetchedAt: new Date().toISOString(),
    });
  }

  // Read-only by design: the dashboard observes saved artifacts but never executes gates.
  // Fresh gate artifacts must come from explicit CLI runs with --save-artifact.
  if (path === "/api/sessions" && request.method === "GET") {
    const payload = await fetchDashboardSessionsIndex(options.projectPath);
    return jsonResponse(payload);
  }

  const sessionRunsMatch = DASHBOARD_SESSION_RUNS.exec(url);
  if (sessionRunsMatch && request.method === "GET") {
    const scope = pathnameGroup(sessionRunsMatch, "scope");
    if (!scope) {
      return jsonResponse({ ok: false, error: "session scope required" }, 400);
    }
    const filter = artifactFilterFromSessionRoute(scope);
    const payload = await fetchDashboardRunsList(options.projectPath, filter);
    return jsonResponse(payload);
  }

  const sessionArtifactsMatch = DASHBOARD_SESSION_ARTIFACTS.exec(url);
  if (sessionArtifactsMatch && request.method === "GET") {
    const scope = pathnameGroup(sessionArtifactsMatch, "scope");
    if (!scope) {
      return jsonResponse({ ok: false, error: "session scope required" }, 400);
    }
    const filter = artifactFilterFromSessionRoute(scope);
    const payload = await fetchDashboardArtifacts(options.projectPath, filter);
    return jsonResponse(payload);
  }

  if (DASHBOARD_ARTIFACT_FEED.test(url) && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const xml = await fetchDashboardArtifactFeed(options.projectPath, {
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

  if (DASHBOARD_ARTIFACT_INDEX_STATS.test(url) && request.method === "GET") {
    const payload = await fetchDashboardArtifactIndexStats(options.projectPath);
    return jsonResponse(payload);
  }

  if (path === "/api/artifacts/aggregates" && request.method === "GET") {
    const filter = parseArtifactListQuery(url.searchParams);
    const payload = await fetchDashboardArtifactAggregates(options.projectPath, filter);
    return jsonResponse(payload);
  }

  const artifactDiffMatch = DASHBOARD_ARTIFACT_DIFF.exec(url);
  if (artifactDiffMatch && request.method === "GET") {
    const gateName = pathnameGroup(artifactDiffMatch, "gate");
    const pathA = url.searchParams.get("a")?.trim() ?? "";
    const pathB = url.searchParams.get("b")?.trim() ?? "";
    if (!gateName || !pathA || !pathB) {
      return jsonResponse({ ok: false, error: "gate, a, and b query params required" }, 400);
    }
    const payload = await fetchDashboardArtifactDiff(options.projectPath, gateName, pathA, pathB);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (path === "/api/artifacts" && request.method === "GET") {
    const filter = parseArtifactListQuery(url.searchParams);
    const payload = await fetchDashboardArtifacts(options.projectPath, filter);
    return jsonResponse(payload);
  }

  if (path === "/api/runs" && request.method === "GET") {
    const filter = parseArtifactListQuery(url.searchParams);
    const payload = await fetchDashboardRunsList(options.projectPath, filter);
    return jsonResponse(payload);
  }

  const runManifestMatch = DASHBOARD_RUN_MANIFEST.exec(url);
  if (runManifestMatch && request.method === "GET") {
    const runId = pathnameGroup(runManifestMatch, "runId");
    if (!runId) {
      return jsonResponse({ ok: false, error: "runId required" }, 400);
    }
    const payload = await fetchDashboardRunManifest(options.projectPath, runId);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  const artifactLineageMatch = DASHBOARD_ARTIFACT_LINEAGE.exec(url);
  if (artifactLineageMatch && request.method === "GET") {
    const gateName = pathnameGroup(artifactLineageMatch, "gate");
    if (!gateName) {
      return jsonResponse({ ok: false, error: "gate required" }, 400);
    }
    const artifactPath = url.searchParams.get("path")?.trim() || undefined;
    const payload = await fetchDashboardArtifactLineage(
      options.projectPath,
      gateName,
      artifactPath
    );
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (path === "/api/gates/graph" && request.method === "GET") {
    const gate = url.searchParams.get("gate")?.trim() || undefined;
    const payload = await fetchDashboardGateGraph(gate);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (path === "/api/artifact-graph" && request.method === "GET") {
    const payload = await fetchDashboardArtifactGraph(options.projectPath);
    return jsonResponse(payload, payload.ok ? 200 : 500);
  }

  if (path === "/api/artifacts/context" && request.method === "GET") {
    const payload = await fetchDashboardArtifactContext(options.projectPath);
    return jsonResponse(payload, payload.ok ? 200 : 500);
  }

  if (path === "/api/artifacts/metadata" && request.method === "GET") {
    const filter = parseArtifactListQuery(url.searchParams);
    const gate = url.searchParams.get("gate")?.trim() || undefined;
    const payload = await fetchDashboardArtifactMetadata(options.projectPath, filter, {
      gate,
    });
    return jsonResponse(payload);
  }

  if (isDashboardArtifactNamespace(path)) {
    return jsonResponse(
      {
        ok: false,
        error:
          "artifact API is read-only; run kimi-doctor --gate <name> --save-artifact to refresh gate artifacts",
      },
      request.method === "GET" ? 404 : 405
    );
  }

  if (path === "/api/debug/logs") {
    const sink = url.searchParams.get("sink")?.trim() ?? "";
    if (!sink) {
      return jsonResponse(fetchDashboardDebugLogSinks(options.projectPath));
    }
    const tailRaw = url.searchParams.get("tail");
    const tail = tailRaw ? Number(tailRaw) : undefined;
    const payload = await fetchDashboardDebugLogs(options.projectPath, sink, tail);
    return jsonResponse(payload, payload.ok ? 200 : 404);
  }

  if (path === "/api/doctor/gates") {
    const payload = await fetchDashboardGateHealth(options.projectPath);
    return jsonResponse(payload);
  }

  if (path === "/api/tls-compliance") {
    const payload = await fetchDashboardTlsCompliance();
    return jsonResponse(payload);
  }

  if (path === "/api/metrics") {
    const payload = await fetchDashboardMetrics(
      hub.lastPayload?.agentCount ?? 0,
      hub.sseSubscriberCount()
    );
    return jsonResponse(payload);
  }

  if (path === "/api/health") {
    const probe = await fetchDashboardProbeHealthInput(options.projectPath);
    const discoveryCtx = hub.discoveryCache.discoveryContext();
    const agentWorkspaceId =
      hub.lastPayload?.agents?.find((row) => row.workspaceId?.trim())?.workspaceId?.trim() ?? null;
    const payload = fetchDashboardHealth({
      agentCount: hub.lastPayload?.agentCount ?? 0,
      sseSubscribers: hub.sseSubscriberCount(),
      herdrConnected: herdrEventBridge.status().connected,
      herdrWorkspaceId: herdrEventBridge.status().workspaceId,
      herdrEnabled: herdrEventBridge.status().enabled,
      gateFailed: gateHealthWatch?.state.lastFailed ?? null,
      discoveryWorkspaceId: discoveryCtx.workspaceId ?? agentWorkspaceId,
      probe,
    });
    return jsonResponse(payload);
  }

  if (path === "/api/widgets/processes/action" && request.method === "POST") {
    const body = await readJsonBody<DashboardPaneActionRequest>(request);
    if (!body?.paneId?.trim() || !body?.action) {
      return jsonResponse({ ok: false, error: "paneId and action required" }, 400);
    }
    const session = body.session?.trim() ?? "";
    const result = await runDashboardPaneAction(
      options.projectPath,
      {
        paneId: body.paneId,
        session,
        action: body.action,
        catalog: hub.discoveryCache.discoveryContext().sessionCatalog,
      },
      options.widgetProcessesActionDeps
    );
    if (result.ok) {
      widgetCache.invalidate(
        buildDashboardWidgetCacheKey(
          "processes",
          options.projectPath,
          session,
          PROCESSES_WIDGET_WORKSPACE_SCOPE
        )
      );
    }
    return jsonResponse(result, result.ok ? 200 : 422);
  }

  if (path.startsWith("/api/widgets/")) {
    const widgetSegment = path.slice("/api/widgets/".length).split("/")[0] ?? "";
    if (!isDashboardWidgetId(widgetSegment)) {
      return new Response("Not Found", { status: 404 });
    }
    const session = url.searchParams.get("session")?.trim() ?? "";
    const paneId = url.searchParams.get("paneId")?.trim() ?? "";
    const linesRaw = url.searchParams.get("lines");
    const lines = linesRaw ? Number(linesRaw) : undefined;
    const commitsRaw = url.searchParams.get("commits");
    const commits = commitsRaw ? Number(commitsRaw) : undefined;
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const payload = await fetchDashboardWidget(
      widgetSegment,
      options.projectPath,
      {
        session,
        paneId,
        lines: Number.isFinite(lines) ? lines : undefined,
        since: Number.isFinite(since) ? since : undefined,
        commits: Number.isFinite(commits) ? commits : undefined,
        catalog: hub.discoveryCache.discoveryContext().sessionCatalog,
      },
      {
        discovery: hub.discoveryCache.discoveryContext(),
        ttlMs: ssePollMs,
        cache: widgetCache,
        processesDeps: options.widgetProcessesDeps,
        logsDeps: options.widgetLogsDeps,
        gitDeps: options.widgetGitDeps,
      }
    );
    return jsonResponse(payload, 200);
  }

  if (path === "/api/actions" && request.method === "POST") {
    const body = await readJsonBody<DashboardActionRequest>(request);
    if (!body?.action || !body.agent) {
      return jsonResponse({ ok: false, error: "action and agent required" }, 400);
    }
    const result = runDashboardAgentAction(body);
    return jsonResponse(result, result.ok ? 200 : 422);
  }

  if (path === "/api/ipc" && request.method === "POST") {
    const body = await readJsonBody<DashboardIpcCommand>(request);
    if (!body?.command) {
      return jsonResponse({ ok: false, error: "command required" }, 400);
    }
    const result = await runDashboardIpcCommand(options.projectPath, body);
    options.onIpc?.(result);
    return jsonResponse(result, result.ok ? 200 : 422);
  }

  return new Response("Not Found", { status: 404 });
}
