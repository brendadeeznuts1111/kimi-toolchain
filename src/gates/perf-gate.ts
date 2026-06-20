import { evaluateEffectBenchmarkGate } from "../lib/effect-benchmark.ts";
import type { Metric } from "../harness/html-reporter.ts";
import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface PerfGateDoctorResult extends GateResult {
  status: "pass" | "fail";
  failures: string[];
  measurements: Metric[];
  timestamp: string;
}

export async function runPerfGate(opts: GateRunOptions = {}): Promise<GateResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const { runEffectBenchmarks } = await import("../harness/perf-monitor.ts");
  const measurements = await runEffectBenchmarks({ projectRoot });
  const gate = await evaluateEffectBenchmarkGate(measurements, undefined, projectRoot);

  const result: PerfGateDoctorResult = {
    status: gate.pass ? "pass" : "fail",
    reason: gate.failures[0],
    failures: gate.failures,
    measurements,
    timestamp: new Date().toISOString(),
  };

  return result;
}

export const perfGateDefinition: Gate = {
  name: "perf-gate",
  description: "Benchmark performance thresholds",
  level: 2,
  dependsOn: ["bunfig-policy"],
  parallel: true,
  run: runPerfGate,
  format: (result) => {
    const row = result as PerfGateDoctorResult;
    const lines = [`${row.status}: perf-gate`];
    for (const failure of row.failures ?? []) lines.push(`       └─ ${failure}`);
    return lines;
  },
};
