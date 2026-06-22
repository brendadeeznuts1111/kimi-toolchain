#!/usr/bin/env bun
/**
 * Memory audit dimension for kimi-doctor.
 *
 * Dimension 14 runs early and gates downstream dimensions when memory is
 * actually critical. On macOS it accounts for file-cache-inflated "used" RAM.
 */

import {
  classifyPressure,
  isActuallyCritical,
  preflightCheck,
  printMemoryTable,
  snapshot,
} from "../lib/memory/governor.ts";

export interface MemoryAuditResult {
  ok: boolean;
  pressure: ReturnType<typeof classifyPressure>;
  usedPercent: number;
  actuallyCritical: boolean;
  message: string;
}

/** Run the memory audit dimension. */
export function auditMemory(): MemoryAuditResult {
  const snap = snapshot();
  const pressure = classifyPressure(snap);
  const actuallyCritical = isActuallyCritical(snap);
  const ok = pressure !== "critical" || !actuallyCritical;

  return {
    ok,
    pressure,
    usedPercent: snap.usedPercent,
    actuallyCritical,
    message: ok
      ? `memory: ${pressure} (${snap.usedPercent}% used)`
      : `memory: CRITICAL — ${snap.usedPercent}% used with real heap pressure`,
  };
}

/** CLI entrypoint for `kimi-doctor` dimension 14. */
export async function runMemoryAudit(): Promise<number> {
  printMemoryTable();
  const result = auditMemory();
  const preflight = preflightCheck("kimi-doctor");

  if (!result.ok || !preflight.ok) {
    console.error(result.message);
    return 1;
  }

  console.log(result.message);
  return 0;
}

if (import.meta.main) {
  process.exit(await runMemoryAudit());
}
