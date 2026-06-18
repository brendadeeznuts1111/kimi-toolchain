/**
 * herdr-dashboard-server.ts — Bun.serve API + static dashboard for orchestrator WebView.
 */

import { join } from "path";
import {
  bunImageSupported,
  DASHBOARD_THUMB_HEIGHT,
  DASHBOARD_THUMB_WIDTH,
  dashboardWebpThumbnail,
  imagePlaceholderDataUrl,
} from "./bun-image.ts";
import { pathExists, readText } from "./bun-io.ts";
import { inspectAgent } from "./inspect.ts";
import {
  DEFAULT_DASHBOARD_PORT,
  fetchDashboardHandoffs,
  fetchDashboardRules,
  runDashboardAgentAction,
  runDashboardIpcCommand,
  type DashboardActionRequest,
  type DashboardFetchOptions,
  type DashboardIpcCommand,
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
import {
  bunHttp3ServeSupported,
  dashboardHttp3Requested,
  dashboardServeScheme,
  resolveDashboardServeTransport,
  type DashboardServeTransport,
} from "./herdr-dashboard-http3.ts";

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
  /** Enable HTTP/3 when TLS certs are configured (see HERDR_DASHBOARD_TLS_* env). */
  http3?: boolean;
  /** Override HERDR_DASHBOARD_TLS_CERT for tests or custom deployments. */
  tlsCertPath?: string;
  /** Override HERDR_DASHBOARD_TLS_KEY for tests or custom deployments. */
  tlsKeyPath?: string;
  onIpc?: (result: ReturnType<typeof runDashboardIpcCommand>) => void;
  /** Optional PNG supplier for `/api/thumbnail` when no cached screenshot is set. */
  screenshotProvider?: () => Promise<Uint8Array | null>;
  /** Bridge Herdr socket events → dashboard refresh (default true). */
  herdrEvents?: boolean;
  /** Bun.WebView shell + persistent profile (surfaced on GET /api/meta). */
  webview?: DashboardMetaWebViewInput;
}

export interface HerdrDashboardServerHandle {
  port: number;
  hostname: string;
  url: string;
  transport: DashboardServeTransport;
  hub: HerdrDashboardHub;
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
  return new Response(readText(path), {
    headers: { "content-type": type, "cache-control": "no-store" },
  });
}

/** LQIP data URL for a cached dashboard screenshot PNG. */
export async function dashboardScreenshotPlaceholder(png: Uint8Array): Promise<string | null> {
  return imagePlaceholderDataUrl(png);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(`${inspectAgent(body)}\n`, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

interface ServeRequest {
  url: string;
  method: string;
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
  const fetchOpts: DashboardFetchOptions = {
    sessions: options.sessions,
    host: options.host,
    domain: options.domain,
    includeDoctor: options.includeDoctor,
    verbose: options.verbose,
  };

  const hub = new HerdrDashboardHub({
    projectPath: options.projectPath,
    fetchOpts,
    pollMs: ssePollMs,
    staleMs,
  });
  hub.start();

  const herdrEventBridge = startDashboardHerdrEventBridge({
    projectPath: options.projectPath,
    hub,
    herdrEvents: options.herdrEvents,
  });

  let screenshotPng: Uint8Array | null = null;

  const { serveOptions, transport } = resolveDashboardServeTransport({
    http3: options.http3,
    certPath: options.tlsCertPath,
    keyPath: options.tlsKeyPath,
  });
  const scheme = dashboardServeScheme(transport);
  const metaWebView = buildDashboardMetaWebView(options.webview);

  const server = Bun.serve({
    hostname,
    port,
    ...serveOptions,
    async fetch(req) {
      const request = req as unknown as ServeRequest;
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/" || path === "/index.html") {
        return new Response(dashboardHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (path === "/herdr-dashboard.css" || path === "/herdr-dashboard.js") {
        const name = path.slice(1);
        return dashboardAssetResponse(name);
      }

      if (path === "/api/meta") {
        const meta: Record<string, unknown> = {
          ok: true,
          projectPath: options.projectPath,
          pollHintMs,
          ssePollMs,
          sse: true,
          staleMs,
          cache: hub.cacheStats(),
          herdrEvents: herdrEventBridge.status(),
          webview: metaWebView,
          dryRun: options.dryRun ?? false,
          thumbnail: bunImageSupported(),
          thumbnailPath: "/api/thumbnail",
          transport: {
            scheme,
            tls: transport.tls,
            http3: transport.http3,
            http3Supported: bunHttp3ServeSupported(),
            http3Requested: dashboardHttp3Requested(options.http3),
            fallbackReason: transport.fallbackReason,
          },
        };
        if (screenshotPng) {
          const placeholder = await dashboardScreenshotPlaceholder(screenshotPng);
          if (placeholder) meta.placeholder = placeholder;
        }
        return jsonResponse(meta);
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
        try {
          const webp = await dashboardWebpThumbnail(png, { width, height, quality });
          if (!webp) {
            return jsonResponse({ ok: false, error: "thumbnail encode failed" }, 500);
          }
          return new Response(webp, {
            headers: {
              "content-type": "image/webp",
              "cache-control": "no-store",
            },
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return jsonResponse({ ok: false, error: message }, 500);
        }
      }

      if (path === "/api/agents") {
        const payload = await hub.refresh();
        return jsonResponse(payload, payload.ok ? 200 : 503);
      }

      if (path === "/api/agents/live") {
        return new Response(hub.createAgentsLiveStream(), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
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
        const result = runDashboardIpcCommand(options.projectPath, body);
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
    herdrEventBridge,
    fetch: server.fetch.bind(server),
    setScreenshotPng: (png: Uint8Array) => {
      screenshotPng = png;
    },
    stop: () => {
      herdrEventBridge.stop();
      hub.stop();
      server.stop();
    },
  };
}
