import {
  probeAllCards,
  summarizeCardStatuses,
  type CardProbeConfig,
  type CardStatus,
} from "../lib/card-probe.ts";
import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export interface CardProbeGateResult extends GateResult {
  status: "pass" | "warn" | "fail";
  statuses: CardStatus[];
  summary: ReturnType<typeof summarizeCardStatuses>;
  timestamp: string;
  elapsedMs: number;
  strict?: boolean;
}

function statusFromSummary(
  summary: ReturnType<typeof summarizeCardStatuses>
): CardProbeGateResult["status"] {
  if (summary.fail > 0) return "fail";
  if (summary.unknown > 0) return "warn";
  return "pass";
}

export async function runCardProbeGate(
  opts: GateRunOptions & { probeConfig?: CardProbeConfig; strict?: boolean } = {}
): Promise<CardProbeGateResult> {
  const started = Bun.nanoseconds();
  const statuses = await probeAllCards(opts.probeConfig);
  const summary = summarizeCardStatuses(statuses);
  const status = statusFromSummary(summary);
  const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

  return {
    status,
    reason:
      status === "pass"
        ? undefined
        : `${summary.fail} failing, ${summary.unknown} unknown of ${summary.total} cards`,
    statuses,
    summary,
    timestamp: new Date().toISOString(),
    elapsedMs,
    strict: opts.strict === true,
  };
}

export const cardProbeGateDefinition: Gate = {
  name: "card-probe",
  description: "Probe examples and Herdr dashboard cards",
  level: 1,
  parallel: true,
  run: runCardProbeGate,
  format: (result) => {
    const row = result as CardProbeGateResult;
    return [
      `${row.status}: card-probe — ${row.summary.pass}/${row.summary.total} pass`,
      `       └─ fail: ${row.summary.fail}, unknown: ${row.summary.unknown}`,
    ];
  },
};
