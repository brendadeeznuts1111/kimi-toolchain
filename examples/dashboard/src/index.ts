/**
 * examples/dashboard — Demo app showcasing kimi-toolchain features.
 *
 * Handlers live in src/handlers/ (SSOT). This file boots Bun.serve only.
 *
 * Start: bun run src/index.ts
 * Open:  http://localhost:5678  (Dashboard Contract v1.0; override with PORT)
 *
 * @see https://bun.com/docs/runtime/http/error-handling#error-callback
 */

import {
  appendDashboardHttpAudit,
  buildDashboardLogEntry,
  isDashboardProbeRequest,
  levelForStatus,
} from "../../../src/lib/dashboard-http-audit.ts";
import {
  parseDashboardCliPort,
  resolveDashboardProjectRoot,
  resolveDashboardStartupPort,
} from "../../../src/lib/dashboard-settings.ts";
import {
  peekServeRequestContext,
  serveErrorCallback,
  withServeRequestContext,
} from "../../../src/lib/serve-error.ts";
import { registerServeMetricsSource } from "../../../src/lib/serve-metrics.ts";
import {
  dashboardWebSocketHandlers,
  handleDashboardWebSocketRequest,
} from "../../../src/lib/serve-websocket.ts";
import { apiCookieLogin, apiCookieLogout, apiCookieProfile } from "./handlers/token-cookies.ts";
import { DASHBOARD_COOKIE_ROUTE_PATHS } from "../../../src/lib/serve-cookies.ts";
import { handleArtifactsRequest } from "./handlers/artifacts.ts";
import { dispatchDashboardRoute } from "./handlers/dispatch.ts";
import { startHttp2DemoServer } from "./handlers/http-2.ts";

const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
const { port: listenPort } = await resolveDashboardStartupPort(projectRoot, {
  cliPort: parseDashboardCliPort(Bun.argv),
});

const isDevelopment = Bun.env.NODE_ENV !== "production";

async function handleDashboardRequest(req: Request): Promise<Response> {
  const artifactResponse = await handleArtifactsRequest(req);
  if (artifactResponse) return artifactResponse;

  const routed = await dispatchDashboardRoute(req);
  if (routed) return routed;

  return new Response("Not Found", { status: 404 });
}

const server = Bun.serve({
  port: listenPort,
  development: isDevelopment,
  routes: {
    [DASHBOARD_COOKIE_ROUTE_PATHS.login]: apiCookieLogin,
    [DASHBOARD_COOKIE_ROUTE_PATHS.profile]: apiCookieProfile,
    [DASHBOARD_COOKIE_ROUTE_PATHS.logout]: apiCookieLogout,
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    const wsResponse = handleDashboardWebSocketRequest(req, server);
    if (wsResponse !== undefined) return wsResponse;

    const start = Bun.nanoseconds();
    const probe = isDashboardProbeRequest(req, url);

    return withServeRequestContext(
      {
        pathname: url.pathname,
        method: req.method,
        startedAt: start,
        probe: probe || undefined,
      },
      async () => {
        const response = await handleDashboardRequest(req);
        appendDashboardHttpAudit(
          buildDashboardLogEntry({
            ts: Bun.nanoseconds(),
            level: levelForStatus(response.status),
            route: url.pathname,
            method: req.method,
            status: response.status,
            durationMs: (Bun.nanoseconds() - start) / 1_000_000,
            probe: probe || undefined,
          })
        );
        return response;
      }
    );
  },
  error(error) {
    const ctx = peekServeRequestContext();
    appendDashboardHttpAudit(
      buildDashboardLogEntry({
        ts: Bun.nanoseconds(),
        level: "error",
        route: ctx?.pathname ?? "unknown",
        method: ctx?.method ?? "GET",
        status: 500,
        durationMs: ctx ? (Bun.nanoseconds() - ctx.startedAt) / 1_000_000 : 0,
        error: error.message,
        probe: ctx?.probe,
      })
    );
    return serveErrorCallback(error);
  },
  websocket: dashboardWebSocketHandlers,
});

registerServeMetricsSource(server);

await startHttp2DemoServer();

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);