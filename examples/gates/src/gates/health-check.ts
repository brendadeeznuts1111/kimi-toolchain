/**
 * Health Check Gate (L1 — tactical)
 *
 * Verifies the process is alive and memory is within bounds.
 *
 * Bun v1.3.13: mimalloc upgraded to v3 + libpas scavenger support.
 * Baseline memory usage is ~5% lower than previous releases.
 * @see https://bun.com/blog/bun-v1.3.13#buns-runtime-uses-5-less-memory
 */

import type { Gate, GateResult } from "./types.ts";

export interface HealthCheckResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: { memoryMB: number; uptimeSec: number };
  timestamp: string;
}

export async function runHealthCheckGate(): Promise<HealthCheckResult> {
  const mem = process.memoryUsage();
  const memoryMB = Math.round(mem.heapUsed / 1024 / 1024);
  const uptimeSec = Math.round(process.uptime());

  let status: HealthCheckResult["status"] = "pass";
  if (memoryMB > 512) status = "fail";
  else if (memoryMB > 256) status = "warn";

  return {
    status,
    reason: status !== "pass" ? `memory: ${memoryMB}MB` : undefined,
    metrics: { memoryMB, uptimeSec },
    timestamp: new Date().toISOString(),
  };
}

export const healthCheckGateDefinition: Gate = {
  name: "health-check",
  description: "Process health and memory bounds (L1)",
  level: 1,
  dependsOn: [],
  parallel: true,
  run: runHealthCheckGate,
  format: (result) => {
    const row = result as HealthCheckResult;
    return [
      `${row.status}: health-check` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ memory: ${row.metrics.memoryMB}MB | uptime: ${row.metrics.uptimeSec}s`,
    ];
  },
};
