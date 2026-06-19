/**
 * Lightweight HTTP cache for live card probe results (kimi-doctor --serve-probe).
 *
 * ADR-0004: serve-probe is observation-only — card health + artifact inspection.
 * Gate execution stays CLI-bound. See docs/adr/ADR-0004-serve-probe-readonly.md.
 */

import { join } from "path";
import { ArtifactStore } from "./artifact-store.ts";
import {
  type CardProbeConfig,
  type CardStatus,
  probeAllCards,
  summarizeCardStatuses,
} from "./card-probe.ts";

export const PROBE_SERVER_HOST_ENV = "PROBE_SERVER_HOST";
export const PROBE_SERVER_PORT_ENV = "PROBE_SERVER_PORT";
/** Future opt-in gate refresh — not wired; reserved for `--allow-gate-refresh`. */
export const ALLOW_GATE_REFRESH_ENV = "ALLOW_GATE_REFRESH";
export const DEFAULT_PROBE_SERVER_HOST = "127.0.0.1";
export const DEFAULT_PROBE_SERVER_PORT = 9239;

export const PROBE_SERVER_ROUTES = [
  { path: "/api/health", methods: ["GET", "HEAD"] as const },
  { path: "/api/cards", methods: ["GET"] as const },
  { path: "/api/refresh", methods: ["GET", "POST"] as const },
  { path: "/api/artifacts", methods: ["GET"] as const },
  { path: "/api/artifacts/:gate", methods: ["GET"] as const },
  { path: "/api/artifacts/:gate/latest", methods: ["GET"] as const },
] as const;

/** Reserved route — returns 403 until opt-in gate refresh is implemented (ADR-0004). */
export const PROBE_ARTIFACT_REFRESH_ROUTE = {
  path: "/api/artifacts/:gate/refresh",
  methods: ["POST"] as const,
} as const;

export const SERVE_PROBE_READONLY_ADR_URL =
  "https://github.com/brendadeeznuts1111/kimi-toolchain/blob/main/docs/adr/ADR-0004-serve-probe-readonly.md";

export interface ProbeServerOptions {
  host?: string;
  port?: number;
  probeConfig?: CardProbeConfig;
  projectRoot?: string;
  saveArtifact?: boolean;
  strict?: boolean;
}

export interface ProbeServerHandle {
  url: string;
  refresh: () => Promise<CardStatus[]>;
  getCached: () => CardStatus[];
  getLastArtifactPath: () => string | undefined;
  stop: () => void;
}

const ARTIFACTS_ROUTE = /^\/api\/artifacts(?:\/([^/]+)(?:\/(latest|refresh))?)?$/;

function artifactRefreshDisabled(gateName: string): Response {
  return jsonResponse(
    {
      error: "Gate refresh disabled",
      reason:
        "Serve-probe is read-only. Run gate via CLI: kimi-doctor --gate <name> --save-artifact",
      gate: gateName,
      docs: SERVE_PROBE_READONLY_ADR_URL,
      futureOptIn: {
        flag: "--allow-gate-refresh",
        env: ALLOW_GATE_REFRESH_ENV,
      },
    },
    403
  );
}

async function artifactFileEntries(
  artifactStore: ArtifactStore,
  projectRoot: string,
  gateName: string
): Promise<Array<{ path: string; timestamp: string | null; size: number }>> {
  const relativePaths = await artifactStore.list(gateName);
  return Promise.all(
    relativePaths.map(async (relativePath) => {
      const absolutePath = join(projectRoot, relativePath);
      const stat = await Bun.file(absolutePath).stat();
      return {
        path: relativePath,
        timestamp: stat?.mtime ? new Date(stat.mtime).toISOString() : null,
        size: stat?.size ?? 0,
      };
    })
  );
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

function artifactStoreFor(options: ProbeServerOptions): ArtifactStore | null {
  const root = options.projectRoot ?? process.cwd();
  return root ? new ArtifactStore(root) : null;
}

/** Start probe cache server on 127.0.0.1:9239 (override via env). */
export async function startProbeServer(
  options: ProbeServerOptions = {}
): Promise<ProbeServerHandle> {
  const host = options.host ?? Bun.env[PROBE_SERVER_HOST_ENV] ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(options.port ?? Bun.env[PROBE_SERVER_PORT_ENV] ?? DEFAULT_PROBE_SERVER_PORT);
  const probeConfig = probeConfigFromEnv(options.probeConfig);
  const projectRoot = options.projectRoot ?? process.cwd();
  const artifactStore = artifactStoreFor({ ...options, projectRoot });

  let cached: CardStatus[] = [];
  let lastFetchedAt = new Date().toISOString();
  let lastArtifactPath: string | undefined;
  let refreshInFlight: Promise<CardStatus[]> | null = null;

  async function persistRefreshArtifact(
    cards: CardStatus[],
    elapsedMs: number
  ): Promise<string | undefined> {
    if (!options.saveArtifact || !artifactStore) return undefined;
    const summary = summarizeCardStatuses(cards);
    lastArtifactPath = await artifactStore.save("card-probe", {
      statuses: cards,
      summary,
      strict: options.strict === true,
      elapsedMs,
      timestamp: lastFetchedAt,
      source: "serve-probe",
    });
    return lastArtifactPath;
  }

  async function refresh(): Promise<CardStatus[]> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const started = Bun.nanoseconds();
      try {
        const cards = await probeAllCards(probeConfig);
        cached = cards;
        lastFetchedAt = new Date().toISOString();
        const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
        await persistRefreshArtifact(cards, elapsedMs);
        return cards;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function handleArtifactsRoute(path: string, method: string): Promise<Response | null> {
    const match = path.match(ARTIFACTS_ROUTE);
    if (!match) return null;

    const gateName = match[1];
    const segment = match[2];

    if (segment === "refresh") {
      if (!gateName) return notFound(path);
      if (method !== "POST") {
        return methodNotAllowed(path, method, [...PROBE_ARTIFACT_REFRESH_ROUTE.methods]);
      }
      return artifactRefreshDisabled(gateName);
    }

    if (method !== "GET") {
      return methodNotAllowed(path, method, ["GET"]);
    }
    if (!artifactStore) {
      return jsonResponse({ ok: false, error: "Artifact store unavailable" }, 500);
    }

    const wantsLatest = segment === "latest";

    if (!gateName) {
      const gates = await artifactStore.listGates();
      return jsonResponse({ ok: true, gates, count: gates.length, projectRoot });
    }

    if (wantsLatest) {
      const latest = await artifactStore.getLatest(gateName);
      if (!latest) {
        return jsonResponse({ ok: false, error: "No artifacts found", gate: gateName }, 404);
      }
      return jsonResponse({
        ok: true,
        gate: gateName,
        projectRoot,
        path: latest.relativePath,
        payload: latest.payload,
      });
    }

    const files = await artifactFileEntries(artifactStore, projectRoot, gateName);
    return jsonResponse({ ok: true, gate: gateName, projectRoot, files });
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
          artifactPath: lastArtifactPath,
        });
      }

      const artifactsResponse = await handleArtifactsRoute(path, method);
      if (artifactsResponse) return artifactsResponse;

      return notFound(path);
    },
  });

  await refresh();

  return {
    url: `http://${host}:${server.port}`,
    refresh,
    getCached: () => cached,
    getLastArtifactPath: () => lastArtifactPath,
    stop: () => server.stop(),
  };
}

export function unhealthyCardStatuses(statuses: CardStatus[]): CardStatus[] {
  return statuses.filter((s) => s.status !== "pass");
}
