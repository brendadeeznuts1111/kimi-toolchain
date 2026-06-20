/**
 * doctor-watch.ts — Continuous effect-gates monitoring for Herdr doctor tab.
 */

import {
  buildEffectGatesReport,
  detectRegressions,
  readEffectGatesSnapshots,
  type EffectGatesReport,
} from "./effect-gates.ts";
import { resolveDoctorPaneId } from "./finish-work-herdr.ts";
import { herdrCliRun, resolveHerdrSession } from "./herdr-project-cli.ts";
import { herdrReportPaneMetadata } from "./herdr-socket-client.ts";
import { writeStdoutLine } from "./cli-contract.ts";
import type { createLogger } from "./logger.ts";

export const EFFECT_GATES_CHANGED_STATUS = "effect.gates.changed";

export const DOCTOR_WATCH_DEFAULT_INTERVAL_SECONDS = 5;

export interface DoctorWatchSnapshot {
  ok: boolean;
  errors: number;
  warnings: number;
  total: number;
  regressions: number;
  generatedAt: string;
}

export function fingerprintDoctorWatch(report: EffectGatesReport, regressions: number): string {
  const payload: DoctorWatchSnapshot = {
    ok: report.summary.errors === 0 && regressions === 0,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    total: report.summary.total,
    regressions,
    generatedAt: report.generatedAt,
  };
  return JSON.stringify(payload);
}

export function formatDoctorWatchChange(
  report: EffectGatesReport,
  regressions: string[]
): string[] {
  const lines = [
    `effect-gates: ${report.summary.total} violation(s), ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`,
  ];
  if (regressions.length > 0) {
    lines.push(`${regressions.length} regression(s):`);
    for (const message of regressions) lines.push(`  ${message}`);
  }
  const sample = report.violations.slice(0, 5);
  for (const violation of sample) {
    const location = violation.location ? `${violation.location}: ` : "";
    lines.push(`  [${violation.severity}] ${location}${violation.message}`);
  }
  if (report.violations.length > 5) {
    lines.push(`  … +${report.violations.length - 5} more`);
  }
  return lines;
}

type Logger = ReturnType<typeof createLogger>;

export interface DoctorWatchOptions {
  projectRoot: string;
  intervalSeconds?: number;
  logger: Logger;
  json?: boolean;
  signal?: AbortSignal;
}

export async function runDoctorWatchOnce(projectRoot: string): Promise<{
  report: EffectGatesReport;
  regressions: string[];
  fingerprint: string;
}> {
  const [previous] = await readEffectGatesSnapshots(projectRoot, 1);
  const report = await buildEffectGatesReport({ projectRoot, tool: "kimi-doctor" });
  const regressionRows = detectRegressions(report, previous ?? null);
  const regressions = regressionRows.map((row) => row.message);
  return {
    report,
    regressions,
    fingerprint: fingerprintDoctorWatch(report, regressions.length),
  };
}

export async function reportEffectGatesChanged(
  fingerprint: string,
  options: { paneId?: string; projectRoot?: string } = {}
): Promise<void> {
  const explicit = options.paneId?.trim() || Bun.env.HERDR_PANE_ID?.trim();
  const resolved = resolveHerdrSession();
  const session = resolved || undefined;
  let paneId = explicit || null;

  if (!paneId) {
    const projectRoot = options.projectRoot || process.cwd();
    const resolved = await resolveDoctorPaneId(projectRoot);
    paneId = resolved.paneId;
  }

  if (!paneId) return;

  herdrReportPaneMetadata({
    paneId,
    source: "kimi-doctor",
    customStatus: EFFECT_GATES_CHANGED_STATUS,
    stateLabels: { effect_gates: fingerprint },
    ttlMs: 120_000,
    session,
  });

  // Force pane.agent_status_changed broadcast via state toggle.
  // Herdr 0.7.0 emits events only on report-agent state transitions,
  // not on report-metadata. blocked → working ensures the orchestrator
  // receives custom_status = "effect.gates.changed" and dispatches react.
  herdrCliRun(session, [
    "pane",
    "report-agent",
    paneId,
    "--source",
    "kimi-doctor",
    "--agent",
    "doctor-watch",
    "--state",
    "blocked",
    "--custom-status",
    EFFECT_GATES_CHANGED_STATUS,
  ]);
  herdrCliRun(session, [
    "pane",
    "report-agent",
    paneId,
    "--source",
    "kimi-doctor",
    "--agent",
    "doctor-watch",
    "--state",
    "working",
    "--custom-status",
    EFFECT_GATES_CHANGED_STATUS,
  ]);
}

export async function runDoctorWatchLoop(options: DoctorWatchOptions): Promise<void> {
  const intervalSeconds = Math.max(
    1,
    options.intervalSeconds ?? DOCTOR_WATCH_DEFAULT_INTERVAL_SECONDS
  );
  const intervalMs = intervalSeconds * 1000;
  let lastFingerprint: string | null = null;

  options.logger.section("kimi-doctor — watch");
  options.logger.line(`Polling effect-gates every ${intervalSeconds}s (Ctrl+C to stop)`);

  const tick = async () => {
    const { report, regressions, fingerprint } = await runDoctorWatchOnce(options.projectRoot);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    await reportEffectGatesChanged(fingerprint, { projectRoot: options.projectRoot });

    const stamp = new Date().toISOString();
    if (options.json) {
      await writeStdoutLine(
        JSON.stringify({
          schemaVersion: 1,
          tool: "kimi-doctor",
          mode: "watch",
          at: stamp,
          summary: {
            ok: report.summary.errors === 0 && regressions.length === 0,
            errors: report.summary.errors,
            warnings: report.summary.warnings,
            total: report.summary.total,
            regressions: regressions.length,
          },
          violations: report.violations,
        })
      );
      return;
    }

    options.logger.line(`[${stamp}]`);
    for (const line of formatDoctorWatchChange(report, regressions)) {
      options.logger.line(line);
    }
  };

  await tick();

  while (!options.signal?.aborted) {
    await Bun.sleep(intervalMs);
    if (options.signal?.aborted) break;
    await tick();
  }
}
