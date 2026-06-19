import type { Metric, PerfGateResult } from "./types.ts";

export function perfGate(metrics: Metric[]): PerfGateResult {
  const failures: string[] = [];

  for (const m of metrics) {
    if (m.skipped) continue;
    if (!m.pass || Number.isNaN(m.actualMs)) {
      failures.push(
        `${m.registryKey ?? m.operation}: ${m.actualMs}ms > ${m.thresholdMs}ms (${m.symbol})`
      );
    }
  }

  return { pass: failures.length === 0, failures };
}
