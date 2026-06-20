/**
 * Doctor gate for configuration-layer health.
 *
 * Audits canonical-references, constants-manifest, constant-parity, and
 * optional scaffold alignment. Integrated into serve-probe as a live card.
 */

import { auditConfigLayersStatus, type ConfigStatusReport } from "../lib/config-status.ts";
import type { Gate, GateResult, GateRunOptions, GateStatus } from "./types.ts";

export interface ConfigStatusGateResult extends GateResult {
  status: GateStatus;
  report: ConfigStatusReport;
  elapsedMs: number;
}

export async function runConfigStatusGate(
  opts: GateRunOptions = {}
): Promise<ConfigStatusGateResult> {
  const started = Bun.nanoseconds();
  const projectRoot = opts.projectRoot ?? process.cwd();
  const report = await auditConfigLayersStatus(projectRoot, {
    withScaffold: false,
  });
  const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
  const status: GateStatus = report.aligned ? "pass" : "fail";
  const failed = report.gates.filter((gate) => gate.status === "fail");
  const reason =
    status === "pass"
      ? undefined
      : `configuration layer gate(s) failed: ${failed.map((g) => g.id).join(", ")}`;

  return {
    status,
    reason,
    report,
    elapsedMs,
  };
}

export const configStatusGateDefinition: Gate = {
  name: "config-status",
  description: "Configuration layers audit (canonical references, constants manifest, parity)",
  level: 2,
  parallel: true,
  run: runConfigStatusGate,
  format: (result) => {
    const row = result as ConfigStatusGateResult;
    const summary = row.report.gates.map((gate) => `${gate.id}: ${gate.status}`).join(", ");
    return [
      `${row.status}: config-status — ${row.report.gates.length} layer(s) audited`,
      `       └─ ${summary}`,
    ];
  },
};
