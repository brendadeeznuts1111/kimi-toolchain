/**
 * Artifact graph health — validates context + execution DAG surfaces for handoff probes.
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { readPackageManifest } from "./utils.ts";
import { ArtifactStore } from "./artifact-store.ts";
import { fetchDashboardArtifactContext, fetchDashboardGateGraph } from "./herdr-dashboard-data.ts";

export const ARTIFACT_GRAPH_SOURCE_MODULE = "src/lib/artifact-graph-health.ts";
export const ARTIFACT_GRAPH_INSPECT_COMMAND = "curl -s http://127.0.0.1:5678/api/artifact-graph";

export type ArtifactGraphProbeSuffix = "context";
export type ArtifactGraphProbeId = `artifact-graph:${ArtifactGraphProbeSuffix}`;

const ARTIFACT_GRAPH_PROBE_SUFFIXES: readonly ArtifactGraphProbeSuffix[] = ["context"];

export interface ArtifactGraphHealthCheck {
  name: string;
  status: "ok" | "error";
  message: string;
  fixable: boolean;
}

export interface ArtifactGraphHealthReport {
  applicable: boolean;
  aligned: boolean;
  checks: ArtifactGraphHealthCheck[];
  fixPlan: string[];
  gateCount: number;
  artifactCount: number;
  edgeCount: number;
  inspectCommand: typeof ARTIFACT_GRAPH_INSPECT_COMMAND;
  sourceModule: typeof ARTIFACT_GRAPH_SOURCE_MODULE;
}

export function isArtifactGraphProbeId(id: string): id is ArtifactGraphProbeId {
  return ARTIFACT_GRAPH_PROBE_SUFFIXES.some((suffix) => id === `artifact-graph:${suffix}`);
}

async function isKimiToolchainRoot(projectRoot: string): Promise<boolean> {
  const packagePath = join(projectRoot, "package.json");
  if (!(await pathExists(packagePath))) return false;
  try {
    const meta = await readPackageManifest(projectRoot);
    return meta?.name === "kimi-toolchain";
  } catch {
    return false;
  }
}

/** Validate artifact context graph and gate execution DAG for the toolchain project. */
export async function auditArtifactGraphHealth(
  projectRoot: string
): Promise<ArtifactGraphHealthReport> {
  const base = {
    inspectCommand: ARTIFACT_GRAPH_INSPECT_COMMAND,
    sourceModule: ARTIFACT_GRAPH_SOURCE_MODULE,
  } as const;

  if (!(await isKimiToolchainRoot(projectRoot))) {
    return {
      applicable: false,
      aligned: true,
      checks: [],
      fixPlan: [],
      gateCount: 0,
      artifactCount: 0,
      edgeCount: 0,
      ...base,
    };
  }

  const checks: ArtifactGraphHealthCheck[] = [];
  const fixPlan: string[] = [];

  const store = new ArtifactStore(projectRoot);
  await store.syncIndexIfDrifted();
  const gates = await store.listGates();
  checks.push({
    name: "artifact-graph:store",
    status: "ok",
    message: `${gates.length} gate(s) indexed`,
    fixable: false,
  });

  const gateGraph = await fetchDashboardGateGraph();
  if (gateGraph.ok && gateGraph.gates.length > 0) {
    checks.push({
      name: "artifact-graph:gate-dag",
      status: "ok",
      message: `${gateGraph.gates.length} builtin gate(s) in execution DAG`,
      fixable: false,
    });
  } else {
    checks.push({
      name: "artifact-graph:gate-dag",
      status: "error",
      message: gateGraph.ok ? "execution DAG empty" : "execution DAG unavailable",
      fixable: true,
    });
    fixPlan.push("verify src/gates/registry.ts and fetchDashboardGateGraph()");
  }

  const context = await fetchDashboardArtifactContext(projectRoot, {
    includeConvergence: false,
  });
  if (context.ok) {
    checks.push({
      name: "artifact-graph:context",
      status: "ok",
      message: `${context.total} artifact node(s), ${context.edges.length} edge(s)`,
      fixable: false,
    });
  } else {
    checks.push({
      name: "artifact-graph:context",
      status: "error",
      message: context.error ?? "context graph build failed",
      fixable: true,
    });
    fixPlan.push("verify ArtifactStore and GET /api/artifacts/context");
  }

  const aligned = checks.every((check) => check.status === "ok");
  return {
    applicable: true,
    aligned,
    checks,
    fixPlan: [...new Set(fixPlan)],
    gateCount: gates.length,
    artifactCount: context.total,
    edgeCount: context.edges.length,
    ...base,
  };
}

/** Evaluate a `probe:artifact-graph:*` handoff condition. */
export async function evaluateArtifactGraphProbeHandoffCondition(
  probeId: ArtifactGraphProbeId,
  projectRoot: string
): Promise<{ ok: boolean; message: string }> {
  const report = await auditArtifactGraphHealth(projectRoot);
  if (!report.applicable) {
    return { ok: false, message: "artifact graph health not applicable for this project" };
  }

  const suffix = probeId.slice("artifact-graph:".length);
  if (suffix !== "context") {
    return { ok: false, message: `unknown artifact-graph probe suffix: ${suffix}` };
  }

  const failed = report.checks.filter((check) => check.status === "error");
  if (failed.length === 0) {
    return {
      ok: true,
      message: `artifact context graph ready (${report.artifactCount} nodes, ${report.edgeCount} edges)`,
    };
  }

  return {
    ok: false,
    message: `${failed[0]?.message ?? "check failed"} — ${report.fixPlan[0] ?? "fix required"}`,
  };
}
