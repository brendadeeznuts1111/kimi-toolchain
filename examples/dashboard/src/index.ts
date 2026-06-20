/**
 * examples/dashboard — Demo app showcasing kimi-toolchain features.
 *
 * Handlers live in src/handlers/ (SSOT). This file boots Bun.serve only.
 *
 * Start: bun run src/index.ts
 * Open:  http://localhost:5678  (Dashboard Contract v1.0; override with PORT)
 */

import {
  buildDashboardLogEntry,
  isDashboardProbeRequest,
  levelForStatus,
  logDashboardEvent,
} from "../../../src/lib/dashboard-logger.ts";
import {
  parseDashboardCliPort,
  resolveDashboardProjectRoot,
  resolveDashboardStartupPort,
} from "../../../src/lib/dashboard-settings.ts";
import { handleArtifactsRequest } from "./handlers/artifacts.ts";
import { dispatchDashboardRoute } from "./handlers/dispatch.ts";
import { startHttp2DemoServer } from "./handlers/http-2.ts";

const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
const { port: listenPort } = await resolveDashboardStartupPort(projectRoot, {
  cliPort: parseDashboardCliPort(Bun.argv),
});

async function handleDashboardRequest(req: Request): Promise<Response> {
  const artifactResponse = await handleArtifactsRequest(req);
  if (artifactResponse) return artifactResponse;

  const routed = await dispatchDashboardRoute(req);
  if (routed) return routed;

  return new Response("Not Found", { status: 404 });
}

const server = Bun.serve({
  port: listenPort,
  async fetch(req) {
    const url = new URL(req.url);
    const start = Bun.nanoseconds();
    const probe = isDashboardProbeRequest(req, url);

    try {
      const response = await handleDashboardRequest(req);
      logDashboardEvent(
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logDashboardEvent(
        buildDashboardLogEntry({
          ts: Bun.nanoseconds(),
          level: "error",
          route: url.pathname,
          method: req.method,
          status: 500,
          durationMs: (Bun.nanoseconds() - start) / 1_000_000,
          error: message,
          probe: probe || undefined,
        })
      );
      return new Response(
        JSON.stringify({ ok: false, error: message, route: url.pathname }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  },
});

await startHttp2DemoServer();

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);
