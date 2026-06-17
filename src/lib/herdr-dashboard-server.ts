/**
 * herdr-dashboard-server.ts — Bun.serve API + static dashboard for orchestrator WebView.
 */

import { join } from "path";
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
import { HerdrDashboardHub } from "./herdr-dashboard-hub.ts";

export interface HerdrDashboardServerOptions extends DashboardFetchOptions {
  projectPath: string;
  port?: number;
  hostname?: string;
  dryRun?: boolean;
  pollHintMs?: number;
  onIpc?: (result: ReturnType<typeof runDashboardIpcCommand>) => void;
}

export interface HerdrDashboardServerHandle {
  port: number;
  hostname: string;
  url: string;
  hub: HerdrDashboardHub;
  stop: () => void;
}

const DASHBOARD_HTML_NAME = "herdr-dashboard.html";

/** Resolve dashboard HTML from repo checkout or synced ~/.kimi-code/templates. */
export function resolveHerdrDashboardHtmlPath(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "templates", DASHBOARD_HTML_NAME),
    join(import.meta.dir, "..", "templates", DASHBOARD_HTML_NAME),
  ];
  return candidates.find((path) => pathExists(path)) ?? candidates[0];
}

function dashboardHtml(): string {
  const path = resolveHerdrDashboardHtmlPath();
  if (pathExists(path)) {
    return readText(path);
  }
  return "<!DOCTYPE html><html><body><h1>herdr-dashboard.html missing</h1></body></html>";
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
    pollMs: pollHintMs,
  });
  hub.start();

  const server = Bun.serve({
    hostname,
    port,
    async fetch(req) {
      const request = req as unknown as ServeRequest;
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/" || path === "/index.html") {
        return new Response(dashboardHtml(), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (path === "/api/meta") {
        return jsonResponse({
          ok: true,
          projectPath: options.projectPath,
          pollHintMs,
          sse: true,
          staleMs: 15_000,
          dryRun: options.dryRun ?? false,
        });
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
    url: `http://${hostname}:${boundPort}/`,
    hub,
    stop: () => {
      hub.stop();
      server.stop();
    },
  };
}
