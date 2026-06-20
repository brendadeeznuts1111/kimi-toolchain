/**
 * Serve-probe client for BenchmarkApiEnvelope — shared by portal/Herdr convergence.
 */

import type { BenchmarkApiEnvelope } from "./effect-benchmark-card.ts";
import {
  DEFAULT_PROBE_SERVER_HOST,
  DEFAULT_PROBE_SERVER_PORT,
  PROBE_SERVER_HOST_ENV,
  PROBE_SERVER_PORT_ENV,
} from "./card-probe-server.ts";

export const BENCHMARK_PROBE_ROUTE = "/api/effect-benchmark";
export const BENCHMARK_PROBE_REFRESH_ROUTE = "/api/effect-benchmark/refresh";

/** Resolve serve-probe effect-benchmark URL (env overrides [doctor.probe] defaults). */
export function resolveBenchmarkProbeUrl(options?: {
  host?: string;
  port?: number;
  path?: string;
}): string {
  const host = Bun.env[PROBE_SERVER_HOST_ENV] ?? options?.host ?? DEFAULT_PROBE_SERVER_HOST;
  const port = Number(Bun.env[PROBE_SERVER_PORT_ENV] ?? options?.port ?? DEFAULT_PROBE_SERVER_PORT);
  const path = options?.path ?? BENCHMARK_PROBE_ROUTE;
  return `http://${host}:${port}${path}`;
}

/** Fetch cached BenchmarkApiEnvelope from kimi-doctor --perf-gates --serve-probe. */
export async function fetchBenchmarkProbeEnvelope(baseUrl?: string): Promise<BenchmarkApiEnvelope> {
  const url = baseUrl ?? resolveBenchmarkProbeUrl();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`benchmark probe ${res.status} ${res.statusText} (${url})`);
  }
  return (await res.json()) as BenchmarkApiEnvelope;
}
