/**
 * artifact-portal.ts — Register diagnostic envelopes for Artifact Portal convergence.
 *
 * Pulls BenchmarkApiEnvelope from serve-probe and persists under `.kimi/artifacts/artifact-portal/`.
 */

import { BENCHMARK_CARD_IDS, BENCHMARK_MANIFEST_ID } from "../canvases/benchmark.manifest.ts";
import type { BenchmarkApiEnvelope } from "./effect-benchmark-card.ts";
import { ArtifactStore } from "./artifact-store.ts";
import { buildPortalManifestPayload, PORTAL_MANIFEST_TYPE } from "./artifact-portal-manifest.ts";
import { fetchBenchmarkProbeEnvelope, resolveBenchmarkProbeUrl } from "./benchmark-probe-client.ts";
import {
  fetchConfigStatusProbeEnvelope,
  resolveConfigStatusProbeUrl,
} from "./config-status-probe-client.ts";
import { auditConfigLayersStatus, type ConfigStatusReport } from "./config-status.ts";
import {
  convergedComponentsFromEnvelope,
  isFullyConvergedEnvelope,
} from "./benchmark-convergence.ts";
import { runEffectBenchmarkCardLoop } from "./effect-benchmark-card.ts";

export const ARTIFACT_PORTAL_GATE = "artifact-portal";
export const PORTAL_BENCHMARK_DIAGNOSTICS_TYPE = "benchmark-diagnostics";
export const PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE = "config-status-diagnostics";
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

export type BenchmarkEnvelopeSource = "serve-probe" | "local-loop";
export type ConfigStatusEnvelopeSource = "serve-probe" | "local-loop";

export interface ResolveBenchmarkEnvelopeResult {
  envelope: BenchmarkApiEnvelope;
  source: BenchmarkEnvelopeSource;
  probeUrl?: string;
}

export interface ResolveConfigStatusEnvelopeResult {
  report: ConfigStatusReport;
  source: ConfigStatusEnvelopeSource;
  probeUrl?: string;
}

export interface BuildArtifactPortalOptions {
  projectRoot?: string;
  probeUrl?: string;
  configStatusProbeUrl?: string;
  /** When true (default), try serve-probe before local loop. */
  preferProbe?: boolean;
  /** Validate the envelope + manifest shape without writing artifacts. */
  dryRun?: boolean;
}

export interface ArtifactPortalBuildResult {
  ok: boolean;
  projectRoot: string;
  contractPath: string;
  canvasManifestId: string;
  builtAt: string;
  dryRun?: boolean;
  benchmark: {
    source: BenchmarkEnvelopeSource;
    probeUrl?: string;
    runner: string;
    artifactPath: string;
  };
  configStatus: {
    source: ConfigStatusEnvelopeSource;
    probeUrl?: string;
    artifactPath: string;
    aligned: boolean;
  };
  portalIndexPath: string;
  converged: boolean;
  convergedComponents: ReturnType<typeof convergedComponentsFromEnvelope>;
  /** Bun `--changed` import-graph title stamped on the benchmark envelope. */
  changedImportGraphTitle?: string;
}

/** Resolve BenchmarkApiEnvelope from serve-probe or local loop fallback. */
export async function resolveBenchmarkEnvelope(
  options: BuildArtifactPortalOptions = {}
): Promise<ResolveBenchmarkEnvelopeResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const preferProbe = options.preferProbe !== false;

  if (preferProbe) {
    const probeUrl = options.probeUrl ?? resolveBenchmarkProbeUrl();
    try {
      const envelope = await fetchBenchmarkProbeEnvelope(probeUrl);
      return { envelope, source: "serve-probe", probeUrl };
    } catch {
      /* fall through to local loop */
    }
  }

  const envelope = await runEffectBenchmarkCardLoop({
    projectRoot,
    runner: "artifact-portal",
    mapTaxonomy: true,
  });
  return { envelope, source: "local-loop" };
}

/** Resolve ConfigStatusReport from serve-probe or local audit fallback. */
export async function resolveConfigStatusEnvelope(
  options: BuildArtifactPortalOptions = {}
): Promise<ResolveConfigStatusEnvelopeResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const preferProbe = options.preferProbe !== false;

  if (preferProbe) {
    const probeUrl = options.configStatusProbeUrl ?? resolveConfigStatusProbeUrl();
    try {
      const report = await fetchConfigStatusProbeEnvelope(probeUrl);
      return { report, source: "serve-probe", probeUrl };
    } catch {
      /* fall through to local loop */
    }
  }

  const report = await auditConfigLayersStatus(projectRoot, { withScaffold: false });
  return { report, source: "local-loop" };
}

/** One-command Artifact Portal publish — benchmark envelope + portal manifest on disk. */
export async function buildArtifactPortal(
  options: BuildArtifactPortalOptions = {}
): Promise<ArtifactPortalBuildResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const builtAt = new Date().toISOString();
  const { envelope, source, probeUrl } = await resolveBenchmarkEnvelope(options);
  const dryRun = options.dryRun === true;

  const benchmarkRecord = dryRun
    ? { artifactPath: "(dry-run)" }
    : await registerPortalArtifact({
        type: PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
        payload: envelope,
        canvasId: BENCHMARK_MANIFEST_ID,
        influences: BENCHMARK_CARD_IDS,
        projectRoot,
        probeUrl,
      });

  const {
    report: configStatusReport,
    source: configStatusSource,
    probeUrl: configStatusProbeUrl,
  } = await resolveConfigStatusEnvelope(options);

  const configStatusRecord = dryRun
    ? { artifactPath: "(dry-run)", aligned: configStatusReport.aligned }
    : await registerPortalArtifact({
        type: PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE,
        payload: configStatusReport,
        canvasId: BENCHMARK_MANIFEST_ID,
        influences: BENCHMARK_CARD_IDS,
        projectRoot,
        probeUrl: configStatusProbeUrl,
      });

  const convergedComponents = convergedComponentsFromEnvelope(envelope);
  const converged = isFullyConvergedEnvelope(envelope);

  const manifestPayload = buildPortalManifestPayload({
    builtAt,
    contract: ARTIFACT_PORTAL_CONTRACT_PATH,
    canvasManifestId: BENCHMARK_MANIFEST_ID,
    diagnosticsType: PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
    source,
    runner: envelope.runner,
    benchmarkArtifactPath: benchmarkRecord.artifactPath,
    probeUrl,
    convergedComponents,
    configStatus: {
      type: PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE,
      source: configStatusSource,
      probeUrl: configStatusProbeUrl,
      artifactPath: configStatusRecord.artifactPath,
      aligned: configStatusReport.aligned,
    },
  });

  const indexRecord = dryRun
    ? { artifactPath: "(dry-run)" }
    : await registerPortalArtifact({
        type: PORTAL_MANIFEST_TYPE,
        payload: manifestPayload,
        canvasId: BENCHMARK_MANIFEST_ID,
        influences: BENCHMARK_CARD_IDS,
        projectRoot,
        probeUrl,
      });

  return {
    ok: true,
    projectRoot,
    contractPath: ARTIFACT_PORTAL_CONTRACT_PATH,
    canvasManifestId: BENCHMARK_MANIFEST_ID,
    builtAt,
    ...(dryRun ? { dryRun: true } : {}),
    benchmark: {
      source,
      probeUrl,
      runner: envelope.runner,
      artifactPath: benchmarkRecord.artifactPath,
    },
    configStatus: {
      source: configStatusSource,
      probeUrl: configStatusProbeUrl,
      artifactPath: configStatusRecord.artifactPath,
      aligned: configStatusReport.aligned,
    },
    portalIndexPath: indexRecord.artifactPath,
    converged,
    convergedComponents,
    changedImportGraphTitle: envelope.metadata.testExecution?.changedImportGraph.title,
  };
}
