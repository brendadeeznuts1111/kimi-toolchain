/**
 * doctor-pipeline.ts — Effect-based doctor aggregation with parallel sub-tool runs.
 */

import { Effect } from "effect";
import type { HealthCheck } from "./health-check.ts";
import { aggregateChecks } from "./health-check.ts";
import { ToolNotFound } from "./effect/errors.ts";
import { runToolEffect, type ToolInvocationWithTaxonomy } from "./effect/tool-runner-effect.ts";
import { defaultToolTimeoutMs } from "./tool-runner.ts";
import type { Logger } from "./logger.ts";

export interface SubDoctorSpec {
  tool: string;
  args: string[];
}

export interface RunSubDoctorsOptions {
  projectRoot: string;
  specs: SubDoctorSpec[];
  quick?: boolean;
  concurrency?: number;
  logger?: Logger;
}

function invocationToCheck(tool: string, result: ToolInvocationWithTaxonomy): HealthCheck {
  const cmd = result.args.join(" ");
  if (result.error) {
    return {
      name: tool,
      status: "error",
      message: `${cmd} failed: ${result.error}`,
      fixable: false,
      category: result.taxonomyId,
      autoFix: result.autoFix,
    };
  }
  if (result.exitCode === 0) {
    return { name: tool, status: "ok", message: `${cmd} passed`, fixable: false };
  }
  const check: HealthCheck = {
    name: tool,
    status: "error",
    message: `${cmd} found problems (exit ${result.exitCode})`,
    fixable: false,
    category: result.taxonomyId,
    autoFix: result.autoFix,
  };
  return check;
}

/** Run sub-tool doctors in parallel via Effect.all. */
export function runSubDoctorsEffect(options: RunSubDoctorsOptions): Effect.Effect<HealthCheck[]> {
  const timeoutMs = options.quick ? defaultToolTimeoutMs() : 120_000;
  const concurrency = options.concurrency ?? 4;

  return Effect.all(
    options.specs.map((spec) =>
      runToolEffect(spec.tool, spec.args, { cwd: options.projectRoot, timeoutMs }).pipe(
        Effect.map((result) => {
          if (options.logger && result.isError && result.suggestion && result.taxonomyId) {
            options.logger.suggest(result.taxonomyId, result.suggestion, result.autoFix);
          }
          return invocationToCheck(spec.tool, result);
        }),
        Effect.catchAll((e) =>
          Effect.succeed({
            name: spec.tool,
            status: "error" as const,
            message: `failed: ${e instanceof ToolNotFound ? e.tool : String(e)}`,
            fixable: false,
          })
        )
      )
    ),
    { concurrency }
  );
}

/** Aggregate sub-doctor checks into a report. */
export function buildSubDoctorReport(tool: string, checks: HealthCheck[]) {
  return aggregateChecks(tool, checks);
}
