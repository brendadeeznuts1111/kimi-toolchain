/**
 * benchmark-convergence.ts — SSOT for Canvas + Dashboard + Herdr portal unification.
 *
 * Every BenchmarkApiEnvelope emission stamps the same convergence block so
 * build:portal, serve-probe, and Herdr register one observable contract.
 */

import { BENCHMARK_CARD_IDS, BENCHMARK_MANIFEST_ID } from "../canvases/benchmark.manifest.ts";

export const BENCHMARK_CONVERGENCE_SCHEMA_VERSION = 1 as const;
export const BENCHMARK_CONVERGENCE_CONTRACT = "contracts/artifact-portal.json";
export const BENCHMARK_PROBE_ROUTE = "/api/effect-benchmark";
export const BENCHMARK_PROBE_REFRESH_ROUTE = "/api/effect-benchmark/refresh";
export const PORTAL_HERDR_PLUGIN_ID = "dev.kimi-toolchain";
export const PORTAL_HERDR_ACTION = "benchmark-portal";

export const CONVERGED_PORTAL_COMPONENTS = ["canvas", "dashboard", "herdr"] as const;
export type ConvergedPortalComponent = (typeof CONVERGED_PORTAL_COMPONENTS)[number];

export interface ConvergedComponentRecord {
  id: ConvergedPortalComponent;
  wired: true;
  ssot: string;
  runner?: string;
}

export interface BenchmarkConvergenceBlock {
  schemaVersion: typeof BENCHMARK_CONVERGENCE_SCHEMA_VERSION;
  contract: string;
  canvasManifestId: string;
  influences: readonly string[];
  probeRoute: string;
  components: ConvergedComponentRecord[];
  /** Populated when serve-probe aggregates live card probe state. */
  dashboardProbe?: {
    cardCount: number;
    okCount: number;
    fetchedAt?: string;
  };
}

const COMPONENT_SSOT: Record<ConvergedPortalComponent, string> = {
  canvas: "src/canvases/benchmark.manifest.ts",
  dashboard: "examples/dashboard/src/handlers/effect-benchmark.ts",
  herdr: "herdr-plugin/benchmark-portal.ts",
};

/** Build the convergence block stamped on every BenchmarkApiEnvelope. */
export function buildBenchmarkConvergenceBlock(
  runner: string,
  dashboardProbe?: BenchmarkConvergenceBlock["dashboardProbe"]
): BenchmarkConvergenceBlock {
  return {
    schemaVersion: BENCHMARK_CONVERGENCE_SCHEMA_VERSION,
    contract: BENCHMARK_CONVERGENCE_CONTRACT,
    canvasManifestId: BENCHMARK_MANIFEST_ID,
    influences: BENCHMARK_CARD_IDS,
    probeRoute: BENCHMARK_PROBE_ROUTE,
    components: CONVERGED_PORTAL_COMPONENTS.map((id) => ({
      id,
      wired: true as const,
      ssot: COMPONENT_SSOT[id],
      ...(id === "dashboard" || runner === "dashboard" ? { runner } : {}),
    })),
    ...(dashboardProbe ? { dashboardProbe } : {}),
  };
}

/** Attach or refresh convergence metadata on an envelope (serve-probe aggregation). */
export function withBenchmarkConvergence<T extends { runner: string; metadata?: object }>(
  envelope: T,
  runner: string,
  dashboardProbe?: BenchmarkConvergenceBlock["dashboardProbe"]
): T {
  return {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      convergence: buildBenchmarkConvergenceBlock(runner, dashboardProbe),
    },
  };
}

/** True when all three portal components are marked wired in the envelope. */
export function isFullyConvergedEnvelope(envelope: {
  metadata?: BenchmarkApiMetadataShape;
}): boolean {
  const block = envelope.metadata?.convergence;
  if (!block) return false;
  const ids = new Set(block.components.map((c) => c.id));
  return CONVERGED_PORTAL_COMPONENTS.every((id) => ids.has(id));
}

interface BenchmarkApiMetadataShape {
  convergence?: BenchmarkConvergenceBlock;
}

/** Portal manifest slice — mirrors buildPortalManifestPayload convergedComponents. */
export function convergedComponentsFromEnvelope(envelope: {
  metadata?: BenchmarkApiMetadataShape;
  runner: string;
}): ConvergedComponentRecord[] {
  const fromMeta = envelope.metadata?.convergence?.components;
  if (fromMeta && fromMeta.length >= CONVERGED_PORTAL_COMPONENTS.length) {
    return fromMeta;
  }
  return buildBenchmarkConvergenceBlock(envelope.runner).components;
}
