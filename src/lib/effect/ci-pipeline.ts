/**
 * Effect-powered CI pipeline for Bun.
 *
 * The thin CLI wrapper only parses flags. This module owns change detection,
 * import-graph impact analysis, scoped subprocess resources, and fail-fast
 * parallel gate execution.
 */

import { Context, Data, Effect, Either, Fiber, Layer } from "effect";
import { join } from "path";
import {
  analyzeImpact,
  buildModuleGraph,
  type ChangeType,
  type ImpactConfig,
  type ImpactResult,
  normalizePath,
} from "../ci-impact.ts";
import { readableStreamToText } from "../bun-utils.ts";
import { ARTIFACTS_REPORTS_DIR, artifactPath } from "../artifacts.ts";
import { safeParse } from "../utils.ts";
import { childTraceEnv, ensureProcessTrace, TRACE_ID_ENV } from "./trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "../trace-ledger.ts";

export class PipelineConfigError extends Data.TaggedError("PipelineConfigError")<{
  path: string;
  message: string;
}> {}

export class PipelineGitError extends Data.TaggedError("PipelineGitError")<{
  command: string;
  message: string;
}> {}

export class PipelineStepFailed extends Data.TaggedError("PipelineStepFailed")<{
  step: string;
  command: string[];
  exitCode: number;
  durationMs: number;
}> {}

export class PipelineResourceError extends Data.TaggedError("PipelineResourceError")<{
  resource: string;
  message: string;
}> {}

export class PipelineDependencyError extends Data.TaggedError("PipelineDependencyError")<{
  message: string;
}> {}

export type PipelineStepError =
  | PipelineConfigError
  | PipelineGitError
  | PipelineStepFailed
  | PipelineResourceError
  | PipelineDependencyError;

export class PipelineInterruptedError extends Data.TaggedError("PipelineInterruptedError")<{
  cause: PipelineStepError;
  cancellationLatencyMs: number;
}> {}

export type PipelineExecutionError = PipelineStepError | PipelineInterruptedError;

export class PipelineRunFailedError extends Data.TaggedError("PipelineRunFailedError")<{
  cause: PipelineExecutionError;
  impact: ImpactResult;
  plannedSteps: PipelineStep[];
  durationMs: number;
  dryRun: boolean;
  metrics: PipelineMetrics;
}> {}

export type PipelineError = PipelineExecutionError | PipelineRunFailedError;

export interface PipelineOptions {
  repoRoot: string;
  base?: string;
  head?: string;
  changed?: string[];
  affected?: boolean;
  full?: boolean;
  json?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  fastMinScore?: number;
  fullMinScore?: number;
}

export interface PipelineEnvironment {
  repoRoot: string;
  base?: string;
  head?: string;
  changed?: string[];
  affected: boolean;
  full: boolean;
  json: boolean;
  dryRun: boolean;
  concurrency: number;
  fastMinScore: number;
  fullMinScore: number;
}

export interface PipelineStep {
  id: string;
  command: string[];
  dependsOn: string[];
  resources: Array<"process" | "temp-home">;
  env?: Record<string, string>;
}

export interface StepReport {
  id: string;
  command: string[];
  durationMs: number;
}

export interface PipelineReport {
  impact: ImpactResult;
  plannedSteps: PipelineStep[];
  steps: StepReport[];
  durationMs: number;
  dryRun: boolean;
  metrics: PipelineMetrics;
}

export interface PipelineMetrics {
  skippedEffectsCount: number;
  totalEffectsCount: number;
  fiberCancellationLatencyMs: number | null;
  changeType: ChangeType;
  pipelineDurationMs: number;
}

export class PipelineEnv extends Context.Tag("PipelineEnv")<PipelineEnv, PipelineEnvironment>() {}

const FULL_EFFECT_IDS = [
  "quality",
  "success-metrics",
  "governance",
  "typecheck",
  "unit",
  "integration",
  "smoke",
  "benchmark",
  "security",
] as const;

export function PipelineEnvLive(options: PipelineOptions) {
  return Layer.succeed(PipelineEnv, {
    repoRoot: options.repoRoot,
    base: options.base,
    head: options.head,
    changed: options.changed,
    affected: options.affected ?? !options.full,
    full: options.full ?? false,
    json: options.json ?? false,
    dryRun: options.dryRun ?? false,
    concurrency: options.concurrency ?? 4,
    fastMinScore: options.fastMinScore ?? 60,
    fullMinScore: options.fullMinScore ?? 60,
  });
}

export function pipelineProgram(): Effect.Effect<PipelineReport, PipelineError, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    const started = Date.now();
    const [config, trackedFiles, changedFiles] = yield* Effect.all(
      [loadImpactConfig(), listTrackedFiles(), getChangedFiles()],
      { concurrency: 3 }
    );
    const graph = yield* Effect.tryPromise({
      try: () => buildModuleGraph(env.repoRoot, trackedFiles),
      catch: (cause) =>
        new PipelineConfigError({
          path: join(env.repoRoot, "ci", "impact.config.json"),
          message: cause instanceof Error ? cause.message : Bun.inspect(cause),
        }),
    });
    const impact = analyzeImpact(
      config,
      env.full || !env.affected ? ["package.json"] : changedFiles,
      graph
    );
    if (env.full) {
      impact.fullRequired = true;
      impact.fullReason = "explicit full pipeline";
      impact.securityRequired = true;
      impact.changeType = "source";
    }
    const steps = buildPipelineSteps(impact, {
      fastMinScore: env.fastMinScore,
      fullMinScore: env.fullMinScore,
    });
    const execution = env.dryRun
      ? { steps: [] as StepReport[], cancellationLatencyMs: null }
      : yield* runFailFast(steps, env.concurrency).pipe(
          Effect.mapError((cause) => {
            const durationMs = Date.now() - started;
            return new PipelineRunFailedError({
              cause,
              impact,
              plannedSteps: steps,
              durationMs,
              dryRun: env.dryRun,
              metrics: buildMetrics(impact, steps, durationMs, getCancellationLatencyMs(cause)),
            });
          })
        );
    const durationMs = Date.now() - started;
    return {
      impact,
      plannedSteps: steps,
      steps: execution.steps,
      durationMs,
      dryRun: env.dryRun,
      metrics: buildMetrics(impact, steps, durationMs, execution.cancellationLatencyMs),
    };
  });
}

export interface PipelinePlanOptions {
  fastMinScore?: number;
  fullMinScore?: number;
}

export function buildPipelineSteps(
  impact: ImpactResult,
  options: PipelinePlanOptions = {}
): PipelineStep[] {
  const scoreMin = impact.fullRequired
    ? (options.fullMinScore ?? 60)
    : (options.fastMinScore ?? 60);
  const sourceLike = impact.fullRequired || impact.changeType === "source";
  const steps: PipelineStep[] = [];

  if (sourceLike) {
    steps.push(step("quality", ["bun", "run", "quality:check:ci"]));
  }

  steps.push(
    step("success-metrics", [
      "bun",
      "run",
      "src/bin/kimi-doctor.ts",
      "--success-metrics",
      "--json",
    ]),
    step("governance", [
      "bun",
      "run",
      "governance",
      "score",
      ...(impact.fullRequired ? [] : ["--fast"]),
      "--min",
      String(scoreMin),
    ])
  );

  if (sourceLike) {
    steps.push(step("typecheck", ["bun", "run", "typecheck"]));
  }

  if (sourceLike && impact.unitTests.length > 0) {
    steps.push(
      step("unit", [
        "bun",
        "run",
        "scripts/run-tests.ts",
        "--ci",
        "--report-file",
        `${ARTIFACTS_REPORTS_DIR}/unit.xml`,
        "--files",
        impact.unitTests.join(","),
      ])
    );
  }

  if (sourceLike && impact.integrationTests.length > 0) {
    steps.push(
      step(
        "integration",
        [
          "bun",
          "run",
          "scripts/run-tests.ts",
          "--ci",
          "--report-file",
          `${ARTIFACTS_REPORTS_DIR}/integration.xml`,
          "--files",
          impact.integrationTests.join(","),
        ],
        { resources: ["temp-home"], dependsOn: ["typecheck"] }
      )
    );
  }

  if (sourceLike && impact.smokeRequired) {
    steps.push(
      step(
        "smoke",
        [
          "bun",
          "run",
          "scripts/run-tests.ts",
          "--ci",
          "--smoke",
          "--report-file",
          `${ARTIFACTS_REPORTS_DIR}/smoke.xml`,
        ],
        { resources: ["temp-home"], dependsOn: ["typecheck"] }
      )
    );
  }

  if (sourceLike && impact.benchmarkIds.length > 0) {
    steps.push(step("benchmark", ["bun", "run", "bench"], { dependsOn: ["typecheck"] }));
  }

  if (impact.fullRequired || impact.securityRequired) {
    steps.push(step("security", ["bun", "run", "src/bin/kimi-guardian.ts", "check"]));
  }

  return steps;
}

/**
 * Execute runnable dependency layers. Within each layer, fork subprocess effects and
 * interrupt all siblings as soon as the first typed gate failure completes.
 */
export function runFailFast(
  steps: PipelineStep[],
  concurrency: number
): Effect.Effect<
  { steps: StepReport[]; cancellationLatencyMs: number | null },
  PipelineExecutionError,
  PipelineEnv
> {
  return Effect.gen(function* () {
    const dependencyError = validateStepDependencies(steps);
    if (dependencyError) {
      return yield* Effect.fail(dependencyError);
    }
    const pending = new Map(steps.map((pipelineStep) => [pipelineStep.id, pipelineStep]));
    const completed = new Set<string>();
    const reports: StepReport[] = [];

    while (pending.size > 0) {
      const ready = Array.from(pending.values()).filter((pipelineStep) =>
        pipelineStep.dependsOn.every((dependency) => completed.has(dependency))
      );
      if (ready.length === 0) {
        return yield* Effect.fail(
          new PipelineDependencyError({
            message: `No runnable steps; remaining: ${Array.from(pending.keys()).join(", ")}`,
          })
        );
      }

      const limit = Math.max(1, concurrency);
      const batchReports: StepReport[] = [];
      for (let index = 0; index < ready.length; index += limit) {
        const chunk = ready.slice(index, index + limit);
        const chunkReports = yield* runFiberBatch(chunk);
        batchReports.push(...chunkReports);
      }
      for (const report of batchReports) {
        reports.push(report);
        completed.add(report.id);
        pending.delete(report.id);
      }
    }

    return { steps: reports, cancellationLatencyMs: null };
  });
}

function runFiberBatch(
  steps: PipelineStep[]
): Effect.Effect<StepReport[], PipelineExecutionError, PipelineEnv> {
  return Effect.gen(function* () {
    const fibers = yield* Effect.all(
      steps.map((pipelineStep, index) =>
        runPipelineStep(pipelineStep).pipe(
          Effect.either,
          Effect.fork,
          Effect.map((fiber) => ({ index, fiber }))
        )
      ),
      { concurrency: steps.length }
    );
    const pending = [...fibers];
    const reports: StepReport[] = [];

    while (pending.length > 0) {
      const completed = yield* Effect.raceAll(
        pending.map(({ index, fiber }) =>
          Fiber.join(fiber).pipe(Effect.map((result) => ({ index, result })))
        )
      );
      const completedIndex = pending.findIndex((entry) => entry.index === completed.index);
      if (completedIndex >= 0) {
        pending.splice(completedIndex, 1);
      }
      if (Either.isLeft(completed.result)) {
        if (pending.length === 0) {
          return yield* Effect.fail(completed.result.left);
        }
        const cancellationStarted = Date.now();
        yield* Fiber.interruptAll(pending.map((entry) => entry.fiber));
        return yield* Effect.fail(
          new PipelineInterruptedError({
            cause: completed.result.left,
            cancellationLatencyMs: Date.now() - cancellationStarted,
          })
        );
      }
      reports.push(completed.result.right);
    }

    return reports;
  });
}

function buildMetrics(
  impact: ImpactResult,
  plannedSteps: PipelineStep[],
  durationMs: number,
  cancellationLatencyMs: number | null
): PipelineMetrics {
  const planned = new Set(plannedSteps.map((pipelineStep) => pipelineStep.id));
  return {
    skippedEffectsCount: FULL_EFFECT_IDS.filter((effectId) => !planned.has(effectId)).length,
    totalEffectsCount: FULL_EFFECT_IDS.length,
    fiberCancellationLatencyMs: cancellationLatencyMs,
    changeType: impact.changeType,
    pipelineDurationMs: durationMs,
  };
}

function step(
  id: string,
  command: string[],
  options: {
    resources?: PipelineStep["resources"];
    dependsOn?: string[];
  } = {}
): PipelineStep {
  return {
    id,
    command,
    dependsOn: options.dependsOn ?? [],
    resources: options.resources ?? ["process"],
  };
}

function validateStepDependencies(steps: PipelineStep[]): PipelineDependencyError | null {
  const ids = new Set(steps.map((pipelineStep) => pipelineStep.id));
  for (const pipelineStep of steps) {
    for (const dependency of pipelineStep.dependsOn) {
      if (!ids.has(dependency)) {
        return new PipelineDependencyError({
          message: `${pipelineStep.id} depends on missing step ${dependency}`,
        });
      }
    }
  }
  return null;
}

function runPipelineStep(
  step: PipelineStep
): Effect.Effect<StepReport, PipelineStepError, PipelineEnv> {
  const run = step.resources.includes("temp-home")
    ? withTempHome(step.id, (home) => runProcess(step, { ...step.env, HOME: home }))
    : runProcess(step, step.env);
  return run.pipe(
    Effect.tap((report) =>
      Effect.sync(() => {
        writeOut(`[ci] ${report.id} passed in ${formatMs(report.durationMs)}\n`);
      })
    )
  );
}

function runProcess(
  step: PipelineStep,
  envOverlay: Record<string, string> | undefined
): Effect.Effect<StepReport, PipelineStepFailed, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const parentTraceId = envOverlay?.[TRACE_ID_ENV] || ensureProcessTrace().traceId;
    const traceOverlay = childTraceEnv(parentTraceId);
    writeOut(`[ci] ${step.id}: ${step.command.join(" ")}\n`);
    return yield* Effect.scoped(
      Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn(step.command, {
            cwd: env.repoRoot,
            stdout: "inherit",
            stderr: "inherit",
            env: { ...Bun.env, ...envOverlay, ...traceOverlay },
          })
        ),
        (proc) =>
          Effect.sync(() => {
            try {
              proc.kill("SIGTERM");
            } catch {
              // Already exited.
            }
          })
      ).pipe(
        Effect.flatMap((proc) =>
          Effect.tryPromise({
            try: () => proc.exited,
            catch: () =>
              new PipelineStepFailed({
                step: step.id,
                command: step.command,
                exitCode: 1,
                durationMs: Date.now() - started,
              }),
          })
        ),
        Effect.flatMap((exitCode) => {
          const durationMs = Date.now() - started;
          return Effect.promise(async () => {
            try {
              await recordTraceEvent(
                buildTraceEvent({
                  traceId: parentTraceId,
                  childTraceIds: traceOverlay.KIMI_TRACE_ID ? [traceOverlay.KIMI_TRACE_ID] : [],
                  eventType: "subprocess",
                  tool: step.id,
                  command: step.command,
                  cwd: env.repoRoot,
                  status: exitCode === 0 ? "ok" : "error",
                  startedAt,
                  endedAt: new Date().toISOString(),
                  durationMs,
                  ...(exitCode === 0 ? {} : { error: `exit ${exitCode}` }),
                })
              );
            } catch {
              // CI tracing is observational only.
            }
          }).pipe(
            Effect.flatMap(() =>
              exitCode === 0
                ? Effect.succeed({
                    id: step.id,
                    command: step.command,
                    durationMs,
                  })
                : Effect.fail(
                    new PipelineStepFailed({
                      step: step.id,
                      command: step.command,
                      exitCode,
                      durationMs,
                    })
                  )
            )
          );
        })
      )
    );
  });
}

function withTempHome<A, E>(
  label: string,
  use: (home: string) => Effect.Effect<A, E, PipelineEnv>
): Effect.Effect<A, E | PipelineResourceError, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    const path = artifactPath(
      env.repoRoot,
      "tmp",
      `.tmp-ci-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    return yield* Effect.scoped(
      Effect.acquireRelease(
        runQuiet(["mkdir", "-p", path], env.repoRoot).pipe(Effect.as(path)),
        (home) =>
          runQuiet(["rm", "-rf", home], env.repoRoot).pipe(Effect.catchAll(() => Effect.void))
      ).pipe(Effect.flatMap(use))
    );
  });
}

function loadImpactConfig(): Effect.Effect<ImpactConfig, PipelineConfigError, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    const path = join(env.repoRoot, "ci", "impact.config.json");
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(path).text(),
      catch: (cause) =>
        new PipelineConfigError({
          path,
          message: cause instanceof Error ? cause.message : Bun.inspect(cause),
        }),
    });
    const config = safeParse<ImpactConfig>(text, null as unknown as ImpactConfig, isImpactConfig);
    if (!config) {
      return yield* Effect.fail(new PipelineConfigError({ path, message: "invalid config shape" }));
    }
    return config;
  });
}

function listTrackedFiles(): Effect.Effect<string[], PipelineGitError, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    const output = yield* capture(["git", "ls-files"], env.repoRoot);
    return splitLines(output).map(normalizePath);
  });
}

function getChangedFiles(): Effect.Effect<string[], PipelineGitError, PipelineEnv> {
  return Effect.gen(function* () {
    const env = yield* PipelineEnv;
    if (env.changed && env.changed.length > 0) return env.changed.map(normalizePath);
    const head = env.head || Bun.env.GITHUB_SHA || "HEAD";
    const base = env.base || defaultBase();
    const output = yield* capture(
      ["git", "diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`],
      env.repoRoot
    ).pipe(
      Effect.catchAll(() =>
        capture(["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD~1...HEAD"], env.repoRoot)
      )
    );
    return splitLines(output).map(normalizePath);
  });
}

function capture(command: string[], cwd: string): Effect.Effect<string, PipelineGitError> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        readableStreamToText(proc.stdout),
        readableStreamToText(proc.stderr),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new PipelineGitError({
          command: command.join(" "),
          message: stderr.trim() || `exit ${exitCode}`,
        });
      }
      return stdout;
    },
    catch: (cause) =>
      cause instanceof PipelineGitError
        ? cause
        : new PipelineGitError({
            command: command.join(" "),
            message: cause instanceof Error ? cause.message : Bun.inspect(cause),
          }),
  });
}

function runQuiet(command: string[], cwd: string): Effect.Effect<void, PipelineResourceError> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([
        readableStreamToText(proc.stderr),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new PipelineResourceError({
          resource: command.join(" "),
          message: stderr.trim() || `exit ${exitCode}`,
        });
      }
    },
    catch: (cause) =>
      cause instanceof PipelineResourceError
        ? cause
        : new PipelineResourceError({
            resource: command.join(" "),
            message: cause instanceof Error ? cause.message : Bun.inspect(cause),
          }),
  });
}

function defaultBase(): string {
  if (Bun.env.GITHUB_BASE_REF) return `origin/${Bun.env.GITHUB_BASE_REF}`;
  const before = Bun.env.GITHUB_EVENT_BEFORE;
  if (before && !/^0+$/.test(before)) return before;
  return "HEAD~1";
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isImpactConfig(value: unknown): value is ImpactConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as ImpactConfig;
  return (
    config.version === 1 &&
    Array.isArray(config.docsOnly) &&
    Array.isArray(config.fullRun) &&
    Array.isArray(config.risky) &&
    Array.isArray(config.security) &&
    Array.isArray(config.benchmarks) &&
    Array.isArray(config.targets)
  );
}

export function printReport(report: PipelineReport, json: boolean, wallClockMs: number): void {
  if (json) {
    writeOut(
      `${JSON.stringify(
        { ...report, metrics: metricsPayload(report.metrics, wallClockMs, report.dryRun, "ok") },
        null,
        2
      )}\n`
    );
    return;
  }
  writeOut("\n");
  writeOut(report.dryRun ? "CI pipeline dry-run complete\n" : "CI pipeline complete\n");
  writeOut(`  duration: ${formatMs(report.durationMs)}\n`);
  writeOut(`  wall clock: ${formatMs(wallClockMs)}\n`);
  writeOut(`  changed files: ${report.impact.changedFiles.length}\n`);
  writeOut(`  affected files: ${report.impact.affectedFiles.length}\n`);
  writeOut(`  change type: ${report.impact.changeType}\n`);
  writeOut(
    `  mode: ${report.impact.docsOnly ? "docs-only" : report.impact.fullRequired ? "full" : "affected"}${
      report.impact.fullReason ? ` (${report.impact.fullReason})` : ""
    }\n`
  );
  writeOut(`  unit tests: ${report.impact.unitTests.length || "none"}\n`);
  writeOut(`  integration tests: ${report.impact.integrationTests.length || "none"}\n`);
  writeOut(`  benchmarks: ${report.impact.benchmarkIds.join(", ") || "none"}\n`);
  writeOut(`  planned gates: ${report.plannedSteps.map((step) => step.id).join(", ")}\n`);
  writeOut(`  executed gates: ${report.steps.map((step) => step.id).join(", ") || "none"}\n`);
  writeOut(
    `  skipped effects: ${report.metrics.skippedEffectsCount}/${report.metrics.totalEffectsCount}\n`
  );
  printMetricsLine(report.metrics, wallClockMs, report.dryRun, "ok");
}

export function printPipelineError(error: PipelineError): void {
  if (error instanceof PipelineRunFailedError) {
    printPipelineError(error.cause);
    return;
  }
  if (error instanceof PipelineInterruptedError) {
    printPipelineError(error.cause);
    writeErr(`[ci] interrupted sibling fibers in ${formatMs(error.cancellationLatencyMs)}\n`);
    return;
  }
  if (error instanceof PipelineStepFailed) {
    writeErr(
      `[ci] ${error.step} failed after ${formatMs(error.durationMs)}: ${error.command.join(" ")} exited ${error.exitCode}\n`
    );
    return;
  }
  if (error instanceof PipelineGitError) {
    writeErr(`[ci] git failed: ${error.command}: ${error.message}\n`);
    return;
  }
  if (error instanceof PipelineConfigError) {
    writeErr(`[ci] config failed: ${error.path}: ${error.message}\n`);
    return;
  }
  if (error instanceof PipelineResourceError) {
    writeErr(`[ci] resource failed: ${error.resource}: ${error.message}\n`);
    return;
  }
  if (error instanceof PipelineDependencyError) {
    writeErr(`[ci] dependency failed: ${error.message}\n`);
    return;
  }
  writeErr(`[ci] failed: ${String(error)}\n`);
}

export function printMetricsLine(
  metrics: PipelineMetrics,
  wallClockMs: number,
  dryRun: boolean,
  status: "ok" | "failed"
): void {
  writeOut(
    `CI_PIPELINE_METRICS ${JSON.stringify(metricsPayload(metrics, wallClockMs, dryRun, status))}\n`
  );
}

function metricsPayload(
  metrics: PipelineMetrics,
  wallClockMs: number,
  dryRun: boolean,
  status: "ok" | "failed"
) {
  return {
    skipped_effects_count: metrics.skippedEffectsCount,
    total_effects_count: metrics.totalEffectsCount,
    fiber_cancellation_latency_ms: metrics.fiberCancellationLatencyMs,
    change_type: metrics.changeType,
    wall_clock_ms: wallClockMs,
    pipeline_duration_ms: metrics.pipelineDurationMs,
    dry_run: dryRun,
    status,
  };
}

function getCancellationLatencyMs(error: PipelineExecutionError): number | null {
  return error instanceof PipelineInterruptedError ? error.cancellationLatencyMs : null;
}

export function genericFailureMetrics(durationMs: number): PipelineMetrics {
  return {
    skippedEffectsCount: 0,
    totalEffectsCount: FULL_EFFECT_IDS.length,
    fiberCancellationLatencyMs: null,
    changeType: "source",
    pipelineDurationMs: durationMs,
  };
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function writeOut(message: string): void {
  Bun.stdout.write(message);
}

function writeErr(message: string): void {
  Bun.stderr.write(message);
}
