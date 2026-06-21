/**
 * artifact-graph-convergence.ts — SSOT for ecosystem vs runtime pillar comparison.
 *
 * `GET /api/artifact-graph` stamps this block so the orchestrator can ask:
 * "does the runtime match what the manifest declares?"
 *
 * @see docs/handoff-rules.md — probe:artifact-graph:context, probe:bun-install:*
 */

import { auditArtifactGraphHealth } from "./artifact-graph-health.ts";
import { auditBunImageHealth } from "./bun-image.ts";
import { auditRuntimeCapabilitiesHealth } from "./bun-install-config.ts";

export const ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_GRAPH_PROBE_ROUTE = "/api/artifact-graph";

export type ConvergenceProbeStatus = "ok" | "error" | "skip";

export interface ArtifactGraphConvergenceBlock {
  schemaVersion: typeof ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION;
  /** Runtime capability inventory (bun-install-config.ts) vs live Bun runtime. */
  bunRuntimeCapabilities: {
    inventoryKeys: number;
    aligned: boolean;
  } | null;
  /** Bun.Image declared capability vs metadata probe. */
  bunImage: {
    available: boolean;
    metadataProbe: ConvergenceProbeStatus;
  } | null;
  /** Artifact store index + gate execution DAG surfaces. */
  context: {
    artifactStore: ConvergenceProbeStatus;
    dag: ConvergenceProbeStatus;
  };
  /** `bun publish --dry-run` release pre-flight (toolchain only). */
  publish: {
    dryRun: ConvergenceProbeStatus;
  } | null;
  /** True when every applicable pillar is ok. */
  aligned: boolean;
  /** Actionable repair hints collected from runtime + artifact-graph health when aligned=false. */
  fixPlan: string[];
}

function checkStatus(
  checks: readonly { name: string; status: "ok" | "error" }[],
  name: string
): ConvergenceProbeStatus {
  const row = checks.find((check) => check.name === name);
  if (!row) return "skip";
  return row.status === "ok" ? "ok" : "error";
}

function metadataProbeStatus(supported: boolean, probe: boolean): ConvergenceProbeStatus {
  if (!supported) return "skip";
  return probe ? "ok" : "error";
}

/** Build the convergence block for artifact-graph APIs and orchestrator handoff. */
export async function buildArtifactGraphConvergenceBlock(
  projectRoot: string
): Promise<ArtifactGraphConvergenceBlock> {
  const [runtimeHealth, bunImageHealth, graphHealth] = await Promise.all([
    auditRuntimeCapabilitiesHealth(projectRoot),
    auditBunImageHealth(),
    auditArtifactGraphHealth(projectRoot),
  ]);

  const bunRuntimeCapabilities = runtimeHealth.applicable
    ? {
        inventoryKeys: runtimeHealth.capabilityCount,
        aligned: runtimeHealth.aligned,
      }
    : null;

  const bunImage = bunImageHealth.applicable
    ? {
        available: bunImageHealth.supported,
        metadataProbe: metadataProbeStatus(bunImageHealth.supported, bunImageHealth.metadataProbe),
      }
    : null;

  const context = {
    artifactStore: graphHealth.applicable
      ? checkStatus(graphHealth.checks, "artifact-graph:store")
      : "skip",
    dag: graphHealth.applicable
      ? checkStatus(graphHealth.checks, "artifact-graph:gate-dag")
      : "skip",
  };

  const publishDryRunCheck = runtimeHealth.checks.find((check) => check.name === "publish:dry-run");
  const publish = runtimeHealth.applicable
    ? {
        dryRun: publishDryRunCheck?.status === "ok" ? ("ok" as const) : ("error" as const),
      }
    : null;

  const pillarAligned = [
    bunRuntimeCapabilities?.aligned ?? true,
    bunImage?.metadataProbe === "ok" || bunImage?.metadataProbe === "skip",
    context.artifactStore === "ok" || context.artifactStore === "skip",
    context.dag === "ok" || context.dag === "skip",
    publish?.dryRun === "ok" || publish === null,
  ].every(Boolean);

  const fixPlan = [...runtimeHealth.fixPlan, ...graphHealth.fixPlan, ...bunImageHealth.fixPlan];

  return {
    schemaVersion: ARTIFACT_GRAPH_CONVERGENCE_SCHEMA_VERSION,
    bunRuntimeCapabilities,
    bunImage,
    context,
    publish,
    aligned: pillarAligned && graphHealth.aligned,
    fixPlan: [...new Set(fixPlan)],
  };
}
