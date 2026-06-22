/**
 * Live probes for /api/kimi-doctor — benchmarks, lineage artifacts, perf files.
 */

import { join } from "path";
import { ArtifactStore, extractArtifactTimestampMs } from "../../../../src/lib/artifact-store.ts";
import { pathExists } from "../../../../src/lib/bun-io.ts";
import {
  buildEffectGatesReport,
  detectRegressions,
  readEffectGatesSnapshots,
  type EffectGatesViolation,
} from "../../../../src/lib/effect-gates.ts";
import { perfGate, runEffectBenchmarks, setThresholdsPath } from "../harness/index.ts";

export const KIMI_DOCTOR_PERF_REGISTRY_ROUTE = "/api/perf-registry";
export const KIMI_DOCTOR_PERF_REGISTRY_CARD = "card-perf-registry";
export const KIMI_DOCTOR_EFFECT_GATES_ROUTE = "/api/gates";

export const KIMI_DOCTOR_LINEAGE_GATES = ["perf-gate", "bunfig-policy", "card-probe"] as const;

export type KimiDoctorLineageGate = (typeof KIMI_DOCTOR_LINEAGE_GATES)[number];

export interface KimiDoctorLiveMetric {
  name: string;
  actualMs: number;
  thresholdMs: number;
  pass: boolean;
  skipped?: boolean;
}

export interface KimiDoctorLiveArtifactGate {
  gate: string;
  count: number;
  latestPath: string | null;
  savedAt: string | null;
  status: string;
  lineageSource?: "stored" | "declarative" | "runtime" | "none";
  dependencyCount?: number;
}

export interface KimiDoctorEffectGatesProbe {
  ok: boolean;
  summary: { total: number; errors: number; warnings: number };
  regressionCount: number;
  violations: EffectGatesViolation[];
  route: typeof KIMI_DOCTOR_EFFECT_GATES_ROUTE;
  fetchedAt: string;
}

export interface KimiDoctorLiveProbe {
  fetchedAt: string;
  perf: {
    allPass: boolean;
    registrySize: number;
    passCount: number;
    failures: string[];
    metrics: KimiDoctorLiveMetric[];
    registryRoute: typeof KIMI_DOCTOR_PERF_REGISTRY_ROUTE;
    registryCardId: typeof KIMI_DOCTOR_PERF_REGISTRY_CARD;
  };
  effectGates?: KimiDoctorEffectGatesProbe;
  artifacts: {
    lineageGates: KimiDoctorLineageGate[];
    savedCount: number;
    artBadge: number;
    gates: KimiDoctorLiveArtifactGate[];
  };
  files: {
    thresholdsJson: boolean;
    thresholdsBaselineJson: boolean;
    perfReportHtml: boolean;
    dashboardDir: string;
  };
  ok: boolean;
}

function artifactPayloadStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const row = payload as Record<string, unknown>;
  if (typeof row.status === "string") return row.status;
  if (typeof row.ok === "boolean") return row.ok ? "pass" : "fail";
  return "unknown";
}

async function probeLineageArtifacts(
  projectRoot: string,
  lineageGates: readonly KimiDoctorLineageGate[]
): Promise<KimiDoctorLiveProbe["artifacts"]> {
  const store = new ArtifactStore(projectRoot);
  await store.syncIndexIfDrifted();

  const gates: KimiDoctorLiveArtifactGate[] = [];
  for (const gateName of lineageGates) {
    const paths = await store.list(gateName);
    const latest = await store.getLatest(gateName);
    const latestPath = latest?.relativePath ?? null;
    let savedAt: string | null = null;
    if (latestPath) {
      const ms = extractArtifactTimestampMs(latestPath);
      savedAt = ms !== null ? new Date(ms).toISOString() : null;
    }

    let lineageSource: KimiDoctorLiveArtifactGate["lineageSource"] = "none";
    let dependencyCount = 0;
    if (latestPath && paths.length > 0) {
      const graph = await store.buildLineageGraph(latestPath);
      if (graph) {
        lineageSource = graph.lineageSource;
        const declarativeCount = graph.resolved.reduce((sum, block) => sum + block.paths.length, 0);
        const runtimeCount = graph.runLineage?.upstreamArtifacts.length ?? 0;
        dependencyCount = declarativeCount > 0 ? declarativeCount : runtimeCount;
      }
    }

    gates.push({
      gate: gateName,
      count: paths.length,
      latestPath,
      savedAt,
      status: paths.length > 0 ? artifactPayloadStatus(latest?.payload) : "missing",
      lineageSource,
      dependencyCount,
    });
  }

  const savedCount = gates.filter((row) => row.count > 0).length;
  return {
    lineageGates: [...lineageGates],
    savedCount,
    artBadge: savedCount,
    gates,
  };
}

function probePerfFiles(dashboardDir: string): KimiDoctorLiveProbe["files"] {
  return {
    thresholdsJson: pathExists(join(dashboardDir, "thresholds.json")),
    thresholdsBaselineJson: pathExists(join(dashboardDir, "thresholds.baseline.json")),
    perfReportHtml: pathExists(join(dashboardDir, "perf-report.html")),
    dashboardDir,
  };
}

/** Scan Effect discipline (same data as kimi-doctor --effect-gates --json, no subprocess). */
export async function probeKimiDoctorEffectGates(
  projectRoot: string
): Promise<KimiDoctorEffectGatesProbe> {
  const [previous] = await readEffectGatesSnapshots(projectRoot, 1);
  const current = await buildEffectGatesReport({ projectRoot, tool: "kimi-doctor-dashboard" });
  const regressions = detectRegressions(current, previous ?? null);
  const ok = current.summary.errors === 0 && regressions.length === 0;

  return {
    ok,
    summary: { ...current.summary },
    regressionCount: regressions.length,
    violations: [...current.violations, ...regressions].slice(0, 12),
    route: KIMI_DOCTOR_EFFECT_GATES_ROUTE,
    fetchedAt: new Date().toISOString(),
  };
}

/** Run live benchmarks + artifact/file probes for the kimi-doctor dashboard card. */
export async function probeKimiDoctorLive(
  projectRoot: string,
  options: {
    dashboardDir?: string;
    lineageGates?: readonly KimiDoctorLineageGate[];
    includeEffectGates?: boolean;
  } = {}
): Promise<KimiDoctorLiveProbe> {
  const dashboardDir = options.dashboardDir ?? join(projectRoot, "examples/dashboard");
  const lineageGates = options.lineageGates ?? KIMI_DOCTOR_LINEAGE_GATES;

  setThresholdsPath(dashboardDir);
  const metrics = await runEffectBenchmarks();
  const gate = perfGate(metrics);
  const perfMetrics: KimiDoctorLiveMetric[] = metrics.map((m) => ({
    name: m.registryKey ?? m.operation,
    actualMs: m.actualMs,
    thresholdMs: m.thresholdMs,
    pass: m.pass,
    ...(m.skipped ? { skipped: true } : {}),
  }));
  const passCount = metrics.filter((m) => m.pass || m.skipped).length;

  const includeEffectGates = options.includeEffectGates === true;
  const [artifacts, files, effectGates] = await Promise.all([
    probeLineageArtifacts(projectRoot, lineageGates),
    Promise.resolve(probePerfFiles(dashboardDir)),
    includeEffectGates ? probeKimiDoctorEffectGates(projectRoot) : Promise.resolve(undefined),
  ]);

  const allPass = gate.pass;
  const effectGatesOk = effectGates?.ok ?? true;
  const ok = allPass && artifacts.savedCount > 0 && effectGatesOk;
  const fetchedAt = new Date().toISOString();

  return {
    fetchedAt,
    perf: {
      allPass,
      registrySize: metrics.length,
      passCount,
      failures: gate.failures,
      metrics: perfMetrics,
      registryRoute: KIMI_DOCTOR_PERF_REGISTRY_ROUTE,
      registryCardId: KIMI_DOCTOR_PERF_REGISTRY_CARD,
    },
    ...(effectGates ? { effectGates } : {}),
    artifacts,
    files,
    ok,
  };
}
