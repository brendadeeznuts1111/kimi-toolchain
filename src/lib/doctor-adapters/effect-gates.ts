/**
 * doctor-adapters/effect-gates.ts — Adapter wrapping the Effect discipline scanner.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../doctor-adapter-types.ts";
import type { EffectGatesReport, EffectGatesViolation } from "../effect-gates.ts";
import {
  buildEffectGatesReport,
  detectRegressions,
  readEffectGatesSnapshots,
} from "../effect-gates.ts";
import { safeParse } from "../utils.ts";

interface EffectGatesJsonEnvelope {
  effectGates?: {
    current?: EffectGatesReport;
    regressions?: EffectGatesViolation[];
  };
}

async function resolveGitHead(projectRoot: string): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return undefined;
    const out = await Bun.readableStreamToText(proc.stdout);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the HealthCheck summary for an Effect-gates run.
 *
 * Exported so the CLI can compute checks without re-running the scan when it
 * already has the report in hand.
 */
export function effectGatesChecksFromReport(
  report: Pick<EffectGatesReport, "summary">,
  regressions: { length: number }
): AdapterOutput["checks"] {
  const errorCount = report.summary.errors;
  const regressionCount = regressions.length;
  const warningCount = report.summary.warnings;

  if (errorCount > 0 || regressionCount > 0) {
    return [
      {
        name: "effect-gates",
        status: "error",
        message: `${errorCount} error(s), ${regressionCount} regression(s)`,
        fixable: true,
        category: "effect_gates_threshold_exceeded",
        autoFix: "kimi-doctor --effect-gates",
      },
    ];
  }

  if (warningCount > 0) {
    return [
      {
        name: "effect-gates",
        status: "warn",
        message: `${warningCount} warning(s), 0 regression(s)`,
        fixable: true,
        category: "effect_gates_threshold_exceeded",
        autoFix: "kimi-doctor --effect-gates",
      },
    ];
  }

  return [
    {
      name: "effect-gates",
      status: "ok",
      message: "Effect discipline clean",
      fixable: false,
    },
  ];
}

export const effectGatesAdapter: ExternalToolAdapter = {
  name: "effect-gates",
  command: ["bun", "run", "src/bin/kimi-doctor.ts", "--effect-gates", "--json"],
  parse(result): AdapterOutput {
    if (result.error) {
      return {
        adapterName: "effect-gates",
        durationMs: result.durationMs,
        checks: [
          {
            name: "effect-gates",
            status: "error",
            message: `adapter effect-gates failed: ${result.error}`,
            fixable: false,
            category: "doctor_adapter_failed",
            autoFix: "kimi-doctor --effect-gates",
          },
        ],
      };
    }
    if (result.timedOut) {
      return {
        adapterName: "effect-gates",
        durationMs: result.durationMs,
        checks: [
          {
            name: "effect-gates",
            status: "error",
            message: `adapter effect-gates timed out after ${result.timeoutMs}ms`,
            fixable: false,
            category: "doctor_adapter_timeout",
          },
        ],
      };
    }

    const envelope = safeParse<EffectGatesJsonEnvelope>(result.stdout, {});
    const report = envelope.effectGates?.current;
    const regressions = envelope.effectGates?.regressions ?? [];

    if (!report) {
      return {
        adapterName: "effect-gates",
        durationMs: result.durationMs,
        checks: [
          {
            name: "effect-gates",
            status: "error",
            message: "adapter effect-gates returned no report",
            fixable: false,
            category: "doctor_adapter_failed",
            autoFix: "kimi-doctor --effect-gates",
          },
        ],
        rawOutput: result.stdout,
      };
    }

    return {
      adapterName: "effect-gates",
      durationMs: result.durationMs,
      checks: effectGatesChecksFromReport(report, regressions),
      rawOutput: result.stdout,
    };
  },
};

/** Run the Effect-gates adapter by building the report directly. */
export async function runEffectGatesAdapter(projectRoot: string): Promise<AdapterOutput> {
  const start = performance.now();
  const gitHead = await resolveGitHead(projectRoot);
  const [previous] = await readEffectGatesSnapshots(projectRoot, 1);
  const report = await buildEffectGatesReport({ projectRoot, tool: "kimi-doctor", gitHead });
  const regressions = detectRegressions(report, previous ?? null);
  return {
    adapterName: "effect-gates",
    durationMs: Math.round(performance.now() - start),
    checks: effectGatesChecksFromReport(report, regressions),
    rawOutput: JSON.stringify(report),
  };
}
