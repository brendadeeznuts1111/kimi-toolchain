/**
 * Lightweight HTTP cache for live card probe results (kimi-doctor --serve-probe).
 *
 * ADR-0004: serve-probe is observation-only — card health + artifact inspection.
 * Gate execution stays CLI-bound. See docs/adr/ADR-0004-serve-probe-readonly.md.
 */

import {
  ArtifactStore,
  extractArtifactTimestamp,
  parseArtifactListQuery,
} from "./artifact-store.ts";
import { DEFAULT_GATE_ARTIFACT_LIMIT } from "../gates/types.ts";
import {
  type CardProbeConfig,
  type CardStatus,
  probeAllCards,
  summarizeCardStatuses,
} from "./card-probe.ts";
import {
  auditRuntimeCapabilitiesHealth,
  type RuntimeCapabilitiesHealthReport,
} from "./bun-install-config.ts";
import { auditConfigLayersStatus, type ConfigStatusReport } from "./config-status.ts";
import {
  DASHBOARD_ARTIFACT_DIFF,
  DASHBOARD_ARTIFACT_FEED,
  DASHBOARD_ARTIFACT_INDEX_STATS,
  DASHBOARD_RUN_MANIFEST,
  matchProbeArtifactsRoute,
  pathnameGroup,
} from "./dashboard-route-patterns.ts";
import {
  fetchDashboardArtifactDiff,
  fetchDashboardArtifactFeed,
  fetchDashboardArtifactIndexStats,
  fetchDashboardRunsList,
} from "./herdr-dashboard-data.ts";
import { withBenchmarkConvergence } from "./benchmark-convergence.ts";
import { type BenchmarkApiEnvelope, runEffectBenchmarkCardLoop } from "./effect-benchmark-card.ts";

export { extractArtifactTimestamp };

export const PROBE_SERVER_HOST_ENV = "PROBE_SERVER_HOST";
export const PROBE_SERVER_PORT_ENV = "PROBE_SERVER_PORT";
/** Future opt-in gate refresh — not wired; reserved for `--allow-gate-refresh`. */
export const ALLOW_GATE_REFRESH_ENV = "ALLOW_GATE_REFRESH";
export const DEFAULT_PROBE_SERVER_HOST = "127.0.0.1";
export const DEFAULT_PROBE_SERVER_PORT = 5678;

export const PROBE_SERVER_ROUTES = [
  { path: "/api/health", methods: ["GET", "HEAD"] as const },
  { path: "/api/cards", methods: ["GET"] as const },
  { path: "/api/refresh", methods: ["GET", "POST"] as const },
  { path: "/api/config-status", methods: ["GET"] as const },
  { path: "/api/bun-runtime", methods: ["GET"] as const },
  { path: "/api/artifacts", methods: ["GET"] as const },
  { path: "/api/artifacts/:gate", methods: ["GET"] as const },
  { path: "/api/artifacts/:gate/latest", methods: ["GET"] as const },
  { path: "/api/artifacts/feed.xml", methods: ["GET"] as const },
  { path: "/api/artifacts/index/stats", methods: ["GET"] as const },
  { path: "/api/artifacts/:gate/diff", methods: ["GET"] as const },
  { path: "/api/runs", methods: ["GET"] as const },
  { path: "/api/runs/:runId", methods: ["GET"] as const },
  { path: "/api/effect-benchmark", methods: ["GET"] as const },
  { path: "/api/effect-benchmark/refresh", methods: ["POST"] as const },
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
  /** Periodic card refresh interval in milliseconds (0 disables). */
  refreshIntervalMs?: number;
  probeConfig?: CardProbeConfig;
  projectRoot?: string;
  saveArtifact?: boolean;
  strict?: boolean;
  /** When true (kimi-doctor --perf-gates --serve-probe), expose BenchmarkApiEnvelope routes. */
  effectBenchmark?: boolean;
  /** Test/embedding seam: pre-seed the expensive BenchmarkApiEnvelope cache. */
  effectBenchmarkEnvelope?: BenchmarkApiEnvelope;
  /** Test/embedding seam: pre-seed the read-only config-status cache. */
  configStatus?: ConfigStatusReport;
  /** Test/embedding seam: pre-seed the platform targeting snapshot. */
  platformTargeting?: PlatformTargetingEnvelope;
}

export interface ProbeServerHandle {
  url: string;
  refresh: () => Promise<CardStatus[]>;
  getCached: () => CardStatus[];
  getConfigStatus: () => ConfigStatusReport | undefined;
  getLastArtifactPath: () => string | undefined;
  getLastConfigStatusArtifactPath: () => string | undefined;
  stop: () => void;
}

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

export interface PlatformTargetingEnvelope {
  cpu: string;
  os: string;
  lockfileBehavior: string;
  supportedCpu: readonly string[];
  supportedOs: readonly string[];
}

function cardsEnvelope(
  cards: CardStatus[],
  fetchedAt: string,
  configStatus?: ConfigStatusReport,
  platformTargeting?: PlatformTargetingEnvelope
): Record<string, unknown> {
  return {
    ok: true,
    cards,
    total: cards.length,
    summary: summarizeCardStatuses(cards),
    fetchedAt,
    ...(configStatus ? { configStatus } : {}),
    ...(platformTargeting ? { platformTargeting } : {}),
  };
}

function artifactStoreFor(options: ProbeServerOptions): ArtifactStore | null {
  const root = options.projectRoot ?? process.cwd();
  return root ? new ArtifactStore(root) : null;
}

/** Start probe cache server (default 127.0.0.1:5678; override via [doctor.probe] or env). */
export async function startProbeServer(
  options: ProbeServerOptions = {}
): Promise<ProbeServerHandle> {
  const host = Bun.env[PROBE_SERVER_HOST_ENV] ?? options.host ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(Bun.env[PROBE_SERVER_PORT_ENV] ?? options.port ?? DEFAULT_PROBE_SERVER_PORT);
  const refreshIntervalMs = Math.max(0, Number(options.refreshIntervalMs ?? 0));
  const probeConfig = probeConfigFromEnv(options.probeConfig);
  const projectRoot = options.projectRoot ?? process.cwd();
  const artifactStore = artifactStoreFor({ ...options, projectRoot });

  let cached: CardStatus[] = [];
  let lastFetchedAt = new Date().toISOString();
  let lastArtifactPath: string | undefined;
  let lastConfigStatusArtifactPath: string | undefined;
  let refreshInFlight: Promise<CardStatus[]> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let benchmarkEnvelope: BenchmarkApiEnvelope | null = options.effectBenchmarkEnvelope ?? null;
  let benchmarkFetchedAt: string | null = null;
  let benchmarkRefreshInFlight: Promise<BenchmarkApiEnvelope> | null = null;
  let configStatus: ConfigStatusReport | undefined = options.configStatus;
  let configStatusFetchedAt: string | null = options.configStatus ? new Date().toISOString() : null;
  let configStatusRefreshInFlight: Promise<ConfigStatusReport | undefined> | null = null;
  let platformTargeting: PlatformTargetingEnvelope | undefined = options.platformTargeting ?? {
    cpu: process.arch,
    os: process.platform,
    lockfileBehavior: "normalized cpu/os stored; skipped if disabled for target",
    supportedCpu: ["arm64", "x64", "ia32", "ppc64", "s390x"] as const,
    supportedOs: ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix"] as const,
  };

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

  async function refreshEffectBenchmark(appendSnapshot = false): Promise<BenchmarkApiEnvelope> {
    if (benchmarkRefreshInFlight) return benchmarkRefreshInFlight;
    benchmarkRefreshInFlight = (async () => {
      try {
        const envelope = await runEffectBenchmarkCardLoop({
          projectRoot,
          runner: "serve-probe",
          appendSnapshot,
          mapTaxonomy: true,
        });
        const converged = withBenchmarkConvergence(envelope, "serve-probe");
        benchmarkEnvelope = converged;
        benchmarkFetchedAt = envelope.timestamp;
        return converged;
      } finally {
        benchmarkRefreshInFlight = null;
      }
    })();
    return benchmarkRefreshInFlight;
  }

  async function refreshConfigStatus(): Promise<ConfigStatusReport | undefined> {
    if (configStatusRefreshInFlight) return configStatusRefreshInFlight;
    configStatusRefreshInFlight = (async () => {
      try {
        const report = await auditConfigLayersStatus(projectRoot);
        configStatus = report;
        configStatusFetchedAt = new Date().toISOString();
        if (options.saveArtifact && artifactStore) {
          lastConfigStatusArtifactPath = await artifactStore.save("config-status", report);
        }
        return report;
      } catch {
        return configStatus;
      } finally {
        configStatusRefreshInFlight = null;
      }
    })();
    return configStatusRefreshInFlight;
  }

  async function refresh(): Promise<CardStatus[]> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const started = Bun.nanoseconds();
      try {
        const cards = await probeAllCards(probeConfig, projectRoot);
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

  async function handleArtifactsRoute(url: URL, method: string): Promise<Response | null> {
    const path = url.pathname;
    const match = matchProbeArtifactsRoute(url);
    if (!match) return null;

    const gateName = match.gateName;
    const segment = match.segment;

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

    const query = parseArtifactListQuery(url.searchParams);
    const listed = await artifactStore.listEntries(gateName, {
      ...query,
      limit: query.limit ?? DEFAULT_GATE_ARTIFACT_LIMIT,
    });
    return jsonResponse({
      ok: true,
      gate: gateName,
      projectRoot,
      count: listed.entries.length,
      total: listed.total,
      ...(listed.since ? { since: listed.since } : {}),
      ...(listed.limit !== undefined ? { limit: listed.limit } : {}),
      files: listed.entries.map((entry) => ({
        path: entry.path,
        timestamp: entry.timestamp,
        ...(entry.size !== undefined ? { size: entry.size } : {}),
        ...(entry.resultSize !== undefined ? { resultSize: entry.resultSize } : {}),
      })),
    });
  }

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
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
        return jsonResponse(cardsEnvelope(cached, lastFetchedAt, configStatus, platformTargeting));
      }

      if (path === "/api/refresh") {
        if (method !== "GET" && method !== "POST") {
          return methodNotAllowed(path, method, ["GET", "POST"]);
        }
        const cards = await refresh();
        return jsonResponse({
          ...cardsEnvelope(cards, lastFetchedAt, configStatus, platformTargeting),
          refreshedAt: lastFetchedAt,
          artifactPath: lastArtifactPath,
        });
      }

      if (path === "/api/config-status") {
        if (method !== "GET") return methodNotAllowed(path, method, ["GET"]);
        const status = configStatus ?? (await refreshConfigStatus());
        return jsonResponse({
          ok: Boolean(status),
          configStatus: status ?? null,
          fetchedAt: configStatusFetchedAt,
        });
      }

      if (path === "/api/bun-runtime") {
        if (method !== "GET") return methodNotAllowed(path, method, ["GET"]);
        const report: RuntimeCapabilitiesHealthReport =
          await auditRuntimeCapabilitiesHealth(projectRoot);
        return jsonResponse({
          ...report,
          ok: report.aligned,
          fetchedAt: new Date().toISOString(),
        });
      }

      if (path === "/api/effect-benchmark") {
        if (!options.effectBenchmark) return notFound(path);
        if (method !== "GET") return methodNotAllowed(path, method, ["GET"]);
        if (!benchmarkEnvelope) {
          await refreshEffectBenchmark(false);
        }
        if (!configStatus) {
          await refreshConfigStatus();
        }
        const probeSummary = {
          cardCount: cached.length,
          okCount: cached.filter((c) => c.status === "pass").length,
          fetchedAt: lastFetchedAt,
        };
        const body = withBenchmarkConvergence(
          benchmarkEnvelope!,
          benchmarkEnvelope!.runner,
          probeSummary
        );
        return jsonResponse({
          ...body,
          configStatus: configStatus!,
          configStatusFetchedAt,
          fetchedAt: benchmarkFetchedAt,
        });
      }

      if (path === "/api/effect-benchmark/refresh") {
        if (!options.effectBenchmark) return notFound(path);
        if (method !== "POST") return methodNotAllowed(path, method, ["POST"]);
        const envelope = await refreshEffectBenchmark(true);
        if (!configStatus) {
          await refreshConfigStatus();
        }
        const probeSummary = {
          cardCount: cached.length,
          okCount: cached.filter((c) => c.status === "pass").length,
          fetchedAt: lastFetchedAt,
        };
        const body = withBenchmarkConvergence(envelope, envelope.runner, probeSummary);
        return jsonResponse({
          ...body,
          configStatus: configStatus!,
          configStatusFetchedAt,
          refreshedAt: benchmarkFetchedAt,
        });
      }

      if (path === "/api/runs" && method === "GET") {
        if (!artifactStore) {
          return jsonResponse({ ok: false, error: "Artifact store unavailable" }, 500);
        }
        const filter = parseArtifactListQuery(url.searchParams);
        const payload = await fetchDashboardRunsList(projectRoot, filter);
        return jsonResponse(payload);
      }

      if (DASHBOARD_ARTIFACT_FEED.test(url) && method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const xml = await fetchDashboardArtifactFeed(projectRoot, {
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

      if (DASHBOARD_ARTIFACT_INDEX_STATS.test(url) && method === "GET") {
        const payload = await fetchDashboardArtifactIndexStats(projectRoot);
        return jsonResponse(payload);
      }

      const artifactDiffMatch = DASHBOARD_ARTIFACT_DIFF.exec(url);
      if (artifactDiffMatch && method === "GET") {
        const gateName = pathnameGroup(artifactDiffMatch, "gate");
        const pathA = url.searchParams.get("a")?.trim() ?? "";
        const pathB = url.searchParams.get("b")?.trim() ?? "";
        if (!gateName || !pathA || !pathB) {
          return jsonResponse({ ok: false, error: "gate, a, and b required" }, 400);
        }
        const payload = await fetchDashboardArtifactDiff(projectRoot, gateName, pathA, pathB);
        return jsonResponse(payload, payload.ok ? 200 : 404);
      }

      const runManifestMatch = DASHBOARD_RUN_MANIFEST.exec(url);
      if (runManifestMatch && method === "GET") {
        if (!artifactStore) {
          return jsonResponse({ ok: false, error: "Artifact store unavailable" }, 500);
        }
        const runId = pathnameGroup(runManifestMatch, "runId");
        if (!runId) {
          return jsonResponse({ ok: false, error: "runId required" }, 400);
        }
        const manifest = await artifactStore.readRunManifest(runId);
        if (!manifest) {
          return jsonResponse({ ok: false, error: "Run not found", runId }, 404);
        }
        const refs = await artifactStore.listRunArtifactRefs(runId, manifest);
        const indexRows = artifactStore.getIndex().findByRunId(runId, { order: "asc" });
        return jsonResponse({
          ok: true,
          projectRoot,
          runId,
          manifest,
          indexSource: refs.some((ref) => ref.indexSource) ? "sqlite" : "manifest",
          artifacts:
            indexRows.length > 0
              ? indexRows.map((row) => ({
                  gate: row.gate,
                  path: row.relativePath,
                  savedAt: row.savedAt,
                  status: row.status ?? null,
                  sessionId: row.sessionId ?? null,
                  runId: row.runId ?? null,
                  contentHash: row.contentHash ?? null,
                }))
              : refs.map((ref) => ({
                  gate: ref.gate,
                  path: ref.relativePath,
                  indexSource: ref.indexSource,
                })),
          fetchedAt: new Date().toISOString(),
        });
      }

      const artifactsResponse = await handleArtifactsRoute(url, method);
      if (artifactsResponse) return artifactsResponse;

      return notFound(path);
    },
  });

  await refresh();
  await refreshConfigStatus();
  if (options.effectBenchmark && !benchmarkEnvelope) {
    await refreshEffectBenchmark(false);
  }

  if (refreshIntervalMs > 0) {
    refreshTimer = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);
  }

  return {
    url: `http://${host}:${server.port}`,
    refresh,
    getCached: () => cached,
    getConfigStatus: () => configStatus,
    getLastArtifactPath: () => lastArtifactPath,
    getLastConfigStatusArtifactPath: () => lastConfigStatusArtifactPath,
    stop: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      server.stop();
    },
  };
}

export function unhealthyCardStatuses(statuses: CardStatus[]): CardStatus[] {
  return statuses.filter((s) => s.status !== "pass" && s.status !== "skip");
}
