/**
 * artifact-portal.ts — Register diagnostic envelopes for Artifact Portal convergence.
 *
 * Pulls BenchmarkApiEnvelope from serve-probe and persists under `.kimi/artifacts/artifact-portal/`.
 */

import {
  BENCHMARK_CARD_IDS,
  BENCHMARK_MANIFEST_ID,
} from "../canvases/benchmark.manifest.ts";
import type { BenchmarkApiEnvelope } from "./effect-benchmark-card.ts";
import { ArtifactStore } from "./artifact-store.ts";
import {
  fetchBenchmarkProbeEnvelope,
  resolveBenchmarkProbeUrl,
} from "./benchmark-probe-client.ts";

export const ARTIFACT_PORTAL_GATE = "artifact-portal";
export const PORTAL_BENCHMARK_DIAGNOSTICS_TYPE = "benchmark-diagnostics";
export const ARTIFACT_PORTAL_CONTRACT_PATH = "contracts/artifact-portal.json";

export interface PortalArtifactInput {
  type: string;
  payload: unknown;
  canvasId?: string;
  influences?: readonly string[];
  projectRoot?: string;
  probeUrl?: string;
}

export interface PortalArtifactRecord {
  type: string;
  canvasId: string;
  influences: string[];
  payload: unknown;
  artifactPath: string;
  registeredAt: string;
}

/** Persist a portal entry envelope under the artifact-portal gate. */
export async function registerPortalArtifact(
  input: PortalArtifactInput
): Promise<PortalArtifactRecord> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const store = new ArtifactStore(projectRoot);
  const registeredAt = new Date().toISOString();
  const canvasId = input.canvasId ?? BENCHMARK_MANIFEST_ID;
  const influences = [...(input.influences ?? BENCHMARK_CARD_IDS)];
  const portalEnvelope = {
    schemaVersion: 1,
    kind: "artifact-portal-entry",
    type: input.type,
    canvasId,
    influences,
    registeredAt,
    ...(input.probeUrl ? { probeUrl: input.probeUrl } : {}),
    payload: input.payload,
  };
  const artifactPath = await store.save(ARTIFACT_PORTAL_GATE, portalEnvelope, {
    level: 1,
    triggeredBy: "artifact-portal",
  });
  return {
    type: input.type,
    canvasId,
    influences,
    payload: input.payload,
    artifactPath,
    registeredAt,
  };
}

export interface PullBenchmarkEnvelopeOptions {
  projectRoot?: string;
  probeUrl?: string;
}

/** Pull live BenchmarkApiEnvelope from serve-probe and register as portal artifact. */
export async function pullBenchmarkEnvelopeAndRegister(
  options: PullBenchmarkEnvelopeOptions = {}
): Promise<{ envelope: BenchmarkApiEnvelope; record: PortalArtifactRecord }> {
  const probeUrl = options.probeUrl ?? resolveBenchmarkProbeUrl();
  const envelope = await fetchBenchmarkProbeEnvelope(probeUrl);
  const record = await registerPortalArtifact({
    type: PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
    payload: envelope,
    canvasId: BENCHMARK_MANIFEST_ID,
    influences: BENCHMARK_CARD_IDS,
    projectRoot: options.projectRoot,
    probeUrl,
  });
  return { envelope, record };
}