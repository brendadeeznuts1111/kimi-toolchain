/**
 * Lightweight HTTP cache for live card probe results (kimi-doctor --serve-probe).
 */

import {
  type CardProbeConfig,
  type CardStatus,
  probeAllCards,
  summarizeCardStatuses,
} from "./card-probe.ts";

export const PROBE_SERVER_HOST_ENV = "PROBE_SERVER_HOST";
export const PROBE_SERVER_PORT_ENV = "PROBE_SERVER_PORT";
export const DEFAULT_PROBE_SERVER_HOST = "127.0.0.1";
export const DEFAULT_PROBE_SERVER_PORT = 9239;

export const PROBE_SERVER_ROUTES = [
  { path: "/api/health", methods: ["GET", "HEAD"] as const },
  { path: "/api/cards", methods: ["GET"] as const },
  { path: "/api/refresh", methods: ["GET", "POST"] as const },
] as const;

export interface ProbeServerOptions {
  host?: string;
  port?: number;
  probeConfig?: CardProbeConfig;
}

export interface ProbeServerHandle {
  url: string;
  refresh: () => Promise<CardStatus[]>;
  getCached: () => CardStatus[];
  stop: () => void;
}

function probeConfigFromEnv(override?: CardProbeConfig): CardProbeConfig {
  return {
    examplesDashboardUrl: override?.examplesDashboardUrl ?? Bun.env.EXAMPLES_DASHBOARD_URL,
    herdrDashboardUrl: override?.herdrDashboardUrl ?? Bun.env.HERDR_DASHBOARD_URL,
    timeoutMs: override?.timeoutMs,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function methodNotAllowed(
  path: string,
  method: string,
  allowedMethods: readonly string[]
): Response {
  return jsonResponse(
    {
      ok: false,
      error: "Method Not Allowed",
      path,
      method,
      allowedMethods: [...allowedMethods],
    },
    405
  );
}

function notFound(path: string): Response {
  return jsonResponse(
    {
      ok: false,
      error: "Not Found",
      path,
      routes: PROBE_SERVER_ROUTES.map((route) => ({
        path: route.path,
        methods: [...route.methods],
      })),
    },
    404
  );
}

function cardsEnvelope(cards: CardStatus[], fetchedAt: string): Record<string, unknown> {
  return {
    ok: true,
    cards,
    total: cards.length,
    summary: summarizeCardStatuses(cards),
    fetchedAt,
  };
}

/** Start probe cache server on 127.0.0.1:9239 (override via env). */
export async function startProbeServer(
  options: ProbeServerOptions = {}
): Promise<ProbeServerHandle> {
  const host = options.host ?? Bun.env[PROBE_SERVER_HOST_ENV] ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(options.port ?? Bun.env[PROBE_SERVER_PORT_ENV] ?? DEFAULT_PROBE_SERVER_PORT);
  const probeConfig = probeConfigFromEnv(options.probeConfig);

  let cached: CardStatus[] = [];
  let lastFetchedAt = new Date().toISOString();
  let refreshInFlight: Promise<CardStatus[]> | null = null;

  async function refresh(): Promise<CardStatus[]> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const cards = await probeAllCards(probeConfig);
        cached = cards;
        lastFetchedAt = new Date().toISOString();
        return cards;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const method = req.method;

      if (path === "/api/health") {
        if (method === "HEAD") {
          return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
        }
        if (method === "GET") {
          return new Response("ok", { status: 200, headers: { "cache-control": "no-store" } });
        }
        return methodNotAllowed(path, method, ["GET", "HEAD"]);
      }

      if (path === "/api/cards") {
        if (method !== "GET") return methodNotAllowed(path, method, ["GET"]);
        return jsonResponse(cardsEnvelope(cached, lastFetchedAt));
      }

      if (path === "/api/refresh") {
        if (method !== "GET" && method !== "POST") {
          return methodNotAllowed(path, method, ["GET", "POST"]);
        }
        const cards = await refresh();
        return jsonResponse({
          ...cardsEnvelope(cards, lastFetchedAt),
          refreshedAt: lastFetchedAt,
        });
      }

      return notFound(path);
    },
  });

  await refresh();

  return {
    url: `http://${host}:${server.port}`,
    refresh,
    getCached: () => cached,
    stop: () => server.stop(),
  };
}

export function unhealthyCardStatuses(statuses: CardStatus[]): CardStatus[] {
  return statuses.filter((s) => s.status !== "pass");
}
