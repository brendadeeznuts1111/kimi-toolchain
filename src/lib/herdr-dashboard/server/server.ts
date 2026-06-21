/**
 * herdr-dashboard-server.ts — Bun.serve bootstrap for orchestrator WebView dashboard.
 *
 * Route dispatch lives in {@link handleDashboardRequest}; static assets in {@link ./assets.ts}.
 *
 * @see https://bun.com/docs/api/http
 */

import { DEFAULT_DASHBOARD_PORT, type DashboardFetchOptions } from "../data/data.ts";
import { startDashboardHerdrEventBridge } from "./events.ts";
import { buildDashboardMetaWebView } from "../webview/store.ts";
import { HerdrDashboardHub } from "./hub.ts";
import { TtlCache } from "../../cache.ts";
import {
  dashboardEventTimestamp,
  writeDashboardEvent,
  closeAuditStore,
} from "../../dashboard-audit-store.ts";
import type { DashboardWidgetResponse } from "../widgets/widgets.ts";
import { startDashboardGateHealthWatch } from "../gates/gate-watch.ts";
import { startDashboardMetaWatch } from "../watch.ts";
import { dashboardServeScheme, resolveDashboardServeTransport } from "./http3.ts";
import { DEFAULT_EXAMPLES_DASHBOARD_URL } from "../../examples-dashboard-companion.ts";
import type { HerdrDashboardServerHandle, HerdrDashboardServerOptions } from "../types.ts";
import { handleDashboardRequest } from "./router.ts";

export type { HerdrDashboardServerHandle, HerdrDashboardServerOptions } from "../types.ts";
export {
  dashboardScreenshotPlaceholder,
  resolveHerdrDashboardAssetPath,
  resolveHerdrDashboardHtmlPath,
  resolveHerdrDashboardTemplatesDir,
} from "./assets.ts";

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
    connect: options.connect,
  });

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

  const screenshotPng = { current: null as Uint8Array | null };
  const widgetCache = new TtlCache<DashboardWidgetResponse>({ ttlMs: ssePollMs });
  const thumbnailCache = new TtlCache<Uint8Array>({ ttlMs: ssePollMs * 2 });
  const metaWebView = buildDashboardMetaWebView(options.webview);

  const routeCtx = {
    options,
    hub,
    herdrEventBridge,
    gateHealthWatch,
    pollHintMs,
    ssePollMs,
    staleMs,
    examplesDashboardUrl,
    screenshotPng,
    widgetCache,
    thumbnailCache,
    metaWebView,
    scheme,
    transport,
  };

  const server = Bun.serve({
    hostname,
    port,
    idleTimeout: 120,
    ...serveOptions,
    fetch: (req) => handleDashboardRequest(req, routeCtx),
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
      screenshotPng.current = png;
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
