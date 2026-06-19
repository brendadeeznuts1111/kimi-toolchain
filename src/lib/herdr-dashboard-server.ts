/**
 * herdr-dashboard-server.ts — Bun.serve API + static dashboard for orchestrator WebView.
 *
 * Thumbnail encode: `GET /api/thumbnail` awaits {@link dashboardThumbnailBytes} (Bun.Image `.blob()` terminal)
 * then returns cached `Uint8Array` — not a live pipeline in `Response`.
 *
 * @see https://bun.com/docs/runtime/image#terminals
 * @see https://bun.com/docs/runtime/image#placeholders — `GET /api/meta` → `meta.placeholder`
 * @see https://bun.com/docs/api/http
 */

import { join } from "path";
import {
  bunImageSupported,
  dashboardThumbnailFeedsActive,
  dashboardThumbnailBytes,
  DASHBOARD_THUMB_HEIGHT,
  DASHBOARD_THUMB_WIDTH,
  negotiateDashboardThumbnailFormat,
  probeBunImageAvifEncode,
  imagePlaceholderDataUrl,
  thumbnailCacheKey,
  thumbnailFormatMime,
  type DashboardThumbnailFormat,
} from "./bun-image.ts";
import { pathExists, readText } from "./bun-io.ts";
import { inspectAgent } from "./inspect.ts";
import { loadDxDefaults } from "./defaults-config.ts";
import {
  DEFAULT_DASHBOARD_PORT,
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
  fetchDashboardGateGraph,
  fetchDashboardProbeCards,
  fetchDashboardProbeHealthInput,
  type DashboardActionRequest,
  type DashboardFetchOptions,
  type DashboardIpcCommand,
  type DashboardIpcResult,
} from "./herdr-dashboard-data.ts";
import {
  startDashboardHerdrEventBridge,
  type DashboardHerdrEventBridgeHandle,
} from "./herdr-dashboard-events.ts";
import {
  buildDashboardMetaWebView,
  type DashboardMetaWebViewInput,
} from "./herdr-dashboard-webview-store.ts";
import { HerdrDashboardHub } from "./herdr-dashboard-hub.ts";
import { HerdrDashboardDiscoveryCache } from "./herdr-dashboard-discovery-cache.ts";
import {
  buildHerdrDashboardEffectImageMeta,
  effectImageMarkBytes,
  effectImageMarkMime,
  EFFECT_IMAGE_MARK_HEIGHT,
  EFFECT_IMAGE_MARK_WIDTH,
} from "./herdr-dashboard-effect-image.ts";
import { artifactFilterFromSessionRoute, parseArtifactListQuery } from "./artifact-store.ts";
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
} from "./dashboard-route-patterns.ts";
import { TtlCache } from "./cache.ts";
import {
  dashboardEventTimestamp,
  writeDashboardEvent,
  closeAuditStore,
  queryDashboardEvents,
  exportEventsToMarkdown,
} from "./dashboard-audit-store.ts";
import {
  buildDashboardWidgetCacheKey,
  fetchDashboardWidget,
  isDashboardWidgetId,
  PROCESSES_WIDGET_WORKSPACE_SCOPE,
  type DashboardWidgetResponse,
} from "./herdr-dashboard-widgets.ts";
import type { GitWidgetDeps } from "./herdr-dashboard-widget-git.ts";
import type { LogsWidgetDeps } from "./herdr-dashboard-widget-logs.ts";
import {
  runDashboardPaneAction,
  type DashboardPaneActionRequest,
  type ProcessesActionDeps,
} from "./herdr-dashboard-widget-processes-action.ts";
import type { ProcessesWidgetDeps } from "./herdr-dashboard-widget-processes.ts";
import {
  startDashboardGateHealthWatch,
  type DashboardGateHealthWatchHandle,
} from "./herdr-dashboard-gate-watch.ts";
import { startDashboardMetaWatch, type DashboardMetaWatchHandle } from "./herdr-dashboard-watch.ts";
import {
  bunHttp3ServeSupported,
  dashboardHttp3Requested,
  dashboardServeScheme,
  resolveDashboardServeTransport,
  type DashboardServeTransport,
} from "./herdr-dashboard-http3.ts";
import {
  DEFAULT_EXAMPLES_DASHBOARD_URL,
  fetchExamplesDashboardHealth,
} from "./examples-dashboard-companion.ts";

export interface HerdrDashboardServerOptions extends DashboardFetchOptions {
  projectPath: string;
  port?: number;
  hostname?: string;
  dryRun?: boolean;
  /** Browser handoffs/rules poll interval (ms). */
  pollHintMs?: number;
  /** Server SSE agent-discovery poll interval (ms). */
  ssePollMs?: number;
  staleMs?: number;
  /** Start dashboard discovery polling immediately (default true unless sessions are disabled). */
  autoRefresh?: boolean;
  /** Enable HTTP/3 when TLS certs are configured (see HERDR_DASHBOARD_TLS_* env). */
  http3?: boolean;
  /** Override HERDR_DASHBOARD_TLS_CERT for tests or custom deployments. */
  tlsCertPath?: string;
  /** Override HERDR_DASHBOARD_TLS_KEY for tests or custom deployments. */
  tlsKeyPath?: string;
  onIpc?: (result: DashboardIpcResult) => void;
  /** Optional PNG supplier for `/api/thumbnail` when no cached screenshot is set. */
  screenshotProvider?: () => Promise<Uint8Array | null>;
  /** Bridge Herdr socket events → dashboard refresh (default true). */
  herdrEvents?: boolean;
  /** Inject discovery cache (tests) — skips default hub cache construction. */
  discoveryCache?: HerdrDashboardDiscoveryCache;
  /** Event-driven meta gate watch on discovery:refreshed (default true). */
  metaWatch?: boolean;
  /** Background effect-gates probe + gate:failed/gate:cleared bus (default true). */
  gateHealthWatch?: boolean;
  /** Bun.WebView shell + persistent profile (surfaced on GET /api/meta). */
  webview?: DashboardMetaWebViewInput;
  /** Inject processes widget fetch (tests). */
  widgetProcessesDeps?: Partial<ProcessesWidgetDeps>;
  /** Inject logs widget fetch (tests). */
  widgetLogsDeps?: Partial<LogsWidgetDeps>;
  /** Inject git widget fetch (tests). */
  widgetGitDeps?: Partial<GitWidgetDeps>;
  /** Inject processes pane actions (tests). */
  widgetProcessesActionDeps?: Partial<ProcessesActionDeps>;
  /** Examples tab iframe base URL (env/config resolved before server start). */
  examplesDashboardUrl?: string;
  /** Spawn examples dashboard companion when health is down (default true). */
  autoStartExamples?: boolean;
}

export interface HerdrDashboardServerHandle {
  port: number;
  hostname: string;
  url: string;
  transport: DashboardServeTransport;
  hub: HerdrDashboardHub;
  metaWatch: DashboardMetaWatchHandle | null;
  gateHealthWatch: DashboardGateHealthWatchHandle | null;
  herdrEventBridge: DashboardHerdrEventBridgeHandle;
  /** In-process request helper (avoids TLS verification for local HTTPS tests). */
  fetch: (input: string | Request) => Response | Promise<Response>;
  /** Cache a dashboard PNG for `/api/thumbnail` encoding. */
  setScreenshotPng: (png: Uint8Array) => void;
  stop: () => void;
}

const DASHBOARD_HTML_NAME = "herdr-dashboard.html";
const DASHBOARD_ASSETS = ["herdr-dashboard.css", "herdr-dashboard.js"] as const;

/** Canonical templates/ dir — repo checkout first, then synced ~/.kimi-code/templates. */
export function resolveHerdrDashboardTemplatesDir(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "templates"),
    join(import.meta.dir, "..", "templates"),
  ];
  return candidates.find((dir) => pathExists(join(dir, DASHBOARD_HTML_NAME))) ?? candidates[0];
}

/** Resolve a dashboard template asset by filename. */
export function resolveHerdrDashboardAssetPath(name: string): string {
  return join(resolveHerdrDashboardTemplatesDir(), name);
}

/** @deprecated Use resolveHerdrDashboardAssetPath("herdr-dashboard.html") */
export function resolveHerdrDashboardHtmlPath(): string {
  return resolveHerdrDashboardAssetPath(DASHBOARD_HTML_NAME);
}

function readDashboardAsset(name: string, fallback: string): string {
  const path = resolveHerdrDashboardAssetPath(name);
  return pathExists(path) ? readText(path) : fallback;
}

function dashboardHtml(): string {
  return readDashboardAsset(
    DASHBOARD_HTML_NAME,
    "<!DOCTYPE html><html><body><h1>herdr-dashboard.html missing</h1></body></html>"
  );
}

function dashboardAssetResponse(name: string): Response {
  const allowed = DASHBOARD_ASSETS.includes(name as (typeof DASHBOARD_ASSETS)[number]);
  if (!allowed) return new Response("Not Found", { status: 404 });
  const path = resolveHerdrDashboardAssetPath(name);
  if (!pathExists(path)) return new Response("Not Found", { status: 404 });
  const type = name.endsWith(".css")
    ? "text/css; charset=utf-8"
    : name.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : "application/octet-stream";
  return new Response(Bun.file(path), {
    headers: withCorsHeaders({ "content-type": type, "cache-control": "no-store" }),
  });
}

function withCorsHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

/** LQIP data URL for a cached dashboard screenshot PNG. */
export async function dashboardScreenshotPlaceholder(png: Uint8Array): Promise<string | null> {
  return imagePlaceholderDataUrl(png);
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

/** Start the orchestrator dashboard HTTP server (agents, handoffs, rules, actions). */
export function startHerdrDashboardServer(
  options: HerdrDashboardServerOptions
): HerdrDashboardServerHandle {
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  const hostname = options.hostname ?? "127.0.0.1";
  const pollHintMs = options.pollHintMs ?? 5000;
  const ssePollMs = options.ssePollMs ?? pollHintMs;
  const staleMs = options.staleMs ?? 15_000;
  const autoRefresh = options.autoRefresh ?? options.sessions !== false;
  const examplesDashboardUrl =
    options.examplesDashboardUrl?.trim() ||
    Bun.env.HERDR_EXAMPLES_DASHBOARD_URL?.trim() ||
    DEFAULT_EXAMPLES_DASHBOARD_URL;
  const fetchOpts: DashboardFetchOptions = {
    sessions: options.sessions,
    host: options.host,
    domain: options.domain,
    includeDoctor: options.includeDoctor,
    verbose: options.verbose,
  };
  const http3Option = Object.hasOwn(options, "http3") ? options.http3 : undefined;
  const { serveOptions, transport } = resolveDashboardServeTransport({
    http3: http3Option,
    certPath: options.tlsCertPath,
    keyPath: options.tlsKeyPath,
  });
  const scheme = dashboardServeScheme(transport);

  const hub = new HerdrDashboardHub({
    projectPath: options.projectPath,
    fetchOpts,
    pollMs: ssePollMs,
    staleMs,
    discoveryCache: options.discoveryCache,
  });
  if (autoRefresh) hub.start();
  const metaWatchEnabled = options.metaWatch !== false;
  const metaWatch = metaWatchEnabled ? startDashboardMetaWatch(hub.eventBus) : null;
  const gateHealthWatchEnabled = options.gateHealthWatch === true && !Bun.env.KIMI_TEST_HOME;
  const gateHealthWatch = gateHealthWatchEnabled
    ? startDashboardGateHealthWatch(hub.eventBus, { projectPath: options.projectPath })
    : null;
  if (autoRefresh) {
    setTimeout(() => void hub.refresh(), 0);
  }

  const herdrEventBridge = startDashboardHerdrEventBridge({
    projectPath: options.projectPath,
    hub,
    herdrEvents: options.herdrEvents,
  });

  // Persist gate and scan events to the audit trail
  hub.eventBus.on("gate:failed", (data) => {
    writeDashboardEvent({
      type: "gate.failed",
      workspace: herdrEventBridge.status().workspaceId ?? undefined,
      payload: data as Record<string, unknown>,
      at: dashboardEventTimestamp(),
    });
  });
  hub.eventBus.on("gate:cleared", (data) => {
    writeDashboardEvent({
      type: "gate.cleared",
      workspace: herdrEventBridge.status().workspaceId ?? undefined,
      payload: data as Record<string, unknown>,
      at: dashboardEventTimestamp(),
    });
  });

  let screenshotPng: Uint8Array | null = null;
  const widgetCache = new TtlCache<DashboardWidgetResponse>({ ttlMs: ssePollMs });
  const thumbnailCache = new TtlCache<Uint8Array>({ ttlMs: ssePollMs * 2 });

  const metaWebView = buildDashboardMetaWebView(options.webview);

  const server = Bun.serve({
    hostname,
    port,
    idleTimeout: 120,
    ...serveOptions,
    async fetch(req) {
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

      const { resolveProbeServerUrl } = await import("./doctor-probe-config.ts");
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
              hasScreenshot: Boolean(screenshotPng),
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
            bunVersion: Bun.version,
            bunRevision: Bun.revision,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
          },
        };
        if (screenshotPng) {
          const placeholder = await dashboardScreenshotPlaceholder(screenshotPng);
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
        return new Response(bytes, {
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
          screenshotPng ?? (options.screenshotProvider ? await options.screenshotProvider() : null);
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
          return new Response(cached, {
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
          return new Response(bytes, {
            headers: withCorsHeaders({
              "content-type": thumbnailFormatMime(format),
              "cache-control": "no-store",
              "x-thumbnail-cache": "miss",
            }),
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
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
        return jsonResponse(fetchDashboardHandoffs(options.projectPath, limit));
      }

      if (path === "/api/rules") {
        return jsonResponse(fetchDashboardRules(options.projectPath, options.dryRun ?? false));
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
        return jsonResponse(fetchDashboardCanvases());
      }

      if (path === "/api/canvas-filter" && request.method === "GET") {
        const { applyCanvasFilter } = await import("./dashboard-canvas-filter.ts");
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
        const payload = await fetchDashboardArtifactDiff(
          options.projectPath,
          gateName,
          pathA,
          pathB
        );
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

      if (path === "/api/artifacts/context" && request.method === "GET") {
        const payload = await fetchDashboardArtifactContext(options.projectPath);
        return jsonResponse(payload, payload.ok ? 200 : 500);
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
          hub.lastPayload?.agents?.find((row) => row.workspaceId?.trim())?.workspaceId?.trim() ??
          null;
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
    },
  });

  const boundPort = server.port ?? port;
  return {
    port: boundPort,
    hostname,
    url: `${scheme}://${hostname}:${boundPort}/`,
    transport,
    hub,
    metaWatch,
    gateHealthWatch,
    herdrEventBridge,
    fetch: server.fetch.bind(server),
    setScreenshotPng: (png: Uint8Array) => {
      screenshotPng = png;
    },
    stop: () => {
      metaWatch?.stop();
      gateHealthWatch?.stop();
      herdrEventBridge.stop();
      hub.stop();
      server.stop();
      closeAuditStore();
    },
  };
}
