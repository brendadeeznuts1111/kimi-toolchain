/**
 * Core check gate pipeline — build steps, run, and format results.
 */

import { bunTestArgs, UNIT_TEST_FILES } from "./test-gates.ts";
import { emitGateFailure, runGate, shouldSilentOnSuccess, type GateResult } from "./gate-runner.ts";
import { readableStreamToText } from "./bun-utils.ts";
import {
  changedIncludesTypeScript,
  countLikelyErrors,
  filterFormatPaths,
  filterRelatedUnitTests,
  resolveChangedContext,
} from "./check-changed.ts";
import { shouldRunScopedLint } from "./check-lint-scoped.ts";
import { SCOPED_ANY_TS, writeScopedGatePass } from "./scoped-gate-cache.ts";
import { isKimiToolchainRepo } from "./workspace-health.ts";
import type { CheckFailure, CheckOptions, CheckRunResult, StepSummary } from "./check-types.ts";

function checkOut(message: string): void {
  Bun.stdout.write(`${message}\n`);
}

function checkErr(message: string): void {
  Bun.stderr.write(`${message}\n`);
}

type SpawnedProcess = ReturnType<typeof Bun.spawn>;

export interface PipelineStep {
  name: string;
  cmd: string[];
  silentOnSuccess?: boolean;
  skipped?: boolean;
}

function toStepSummary(result: GateResult): StepSummary {
  const errors = countLikelyErrors(result.name, result.stdout, result.stderr);
  return {
    passed: result.exitCode === 0,
    durationMs: result.ms,
    skipped: result.skipped,
    ...(errors !== undefined ? { errors } : {}),
  };
}

function failureFromResult(result: GateResult): CheckFailure {
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const message = detail.split("\n").find((line) => line.trim()) ?? "failed";
  return { step: result.name, message };
}

export function buildCheckResult(results: GateResult[]): CheckRunResult {
  const steps: Record<string, StepSummary> = {};
  let totalDurationMs = 0;
  const failures: CheckFailure[] = [];

  for (const result of results) {
    steps[result.name] = toStepSummary(result);
    totalDurationMs += result.ms;
    if (result.exitCode !== 0 && !result.skipped) {
      failures.push(failureFromResult(result));
    }
  }

  return {
    passed: results.every((result) => result.exitCode === 0),
    steps,
    failures,
    totalDurationMs,
  };
}

export async function buildSteps(
  projectRoot: string,
  options: CheckOptions,
  changedFiles: string[] | null,
  baseRef: string | null = null
): Promise<PipelineStep[]> {
  const quiet = !options.verbose && shouldSilentOnSuccess();
  const steps: PipelineStep[] = [];

  if (options.staged) {
    steps.push({
      name: "pre-commit",
      cmd: ["bun", "run", "src/bin/kimi-githooks.ts", "run-gates", "pre-commit"],
      silentOnSuccess: quiet,
    });
  }
  if (!options.fast && (await isKimiToolchainRepo(projectRoot))) {
    steps.push({
      name: "verify-workspace",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"],
      silentOnSuccess: quiet,
    });
  }

  steps.push({
    name: "success-metrics",
    cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "--success-metrics", "--json"],
    silentOnSuccess: true,
  });

  const formatPaths = changedFiles ? filterFormatPaths(changedFiles) : null;
  if (changedFiles && formatPaths?.length === 0) {
    steps.push({ name: "format:check", cmd: [], skipped: true });
  } else if (formatPaths && formatPaths.length > 0) {
    steps.push({
      name: "format:check",
      cmd: ["oxfmt", "--check", "-c", ".oxfmtrc.json", ...formatPaths],
      silentOnSuccess: quiet,
    });
  } else {
    steps.push({
      name: "format:check",
      cmd: ["bun", "run", "format:check"],
      silentOnSuccess: quiet,
    });
  }

  if (changedFiles && !shouldRunScopedLint(changedFiles)) {
    steps.push({ name: "lint", cmd: [], skipped: true });
  } else if (changedFiles) {
    steps.push({
      name: "lint",
      cmd: ["bun", "run", "scripts/lint-changed.ts", ...changedFiles],
      silentOnSuccess: quiet,
    });
  } else {
    steps.push({
      name: "lint",
      cmd: ["bun", "run", "lint"],
      silentOnSuccess: quiet,
    });
  }

  if (changedFiles && !changedIncludesTypeScript(changedFiles)) {
    steps.push({ name: "typecheck", cmd: [], skipped: true });
  } else {
    steps.push({
      name: "typecheck",
      cmd: ["bun", "run", "typecheck"],
      silentOnSuccess: quiet,
    });
  }

  if (!options.skipTests) {
    const testName = options.fast ? "test:fast" : "test";
    const useBunChanged = options.changedOnly && baseRef;

    if (changedFiles && changedFiles.length === 0) {
      steps.push({ name: testName, cmd: [], skipped: true });
    } else if (useBunChanged) {
      const testArgs = bunTestArgs({
        changedRef: baseRef,
        timeoutMs: options.timeoutMs,
        bail: true,
        retry: 2,
        dots: quiet,
      });
      steps.push({
        name: testName,
        cmd: ["bun", ...testArgs],
        silentOnSuccess: quiet,
      });
    } else {
      const related =
        changedFiles && changedFiles.length > 0 ? filterRelatedUnitTests(changedFiles) : null;

      if (related && related.length === 0) {
        steps.push({ name: testName, cmd: [], skipped: true });
      } else {
        const useSubset = related !== null && related.length < UNIT_TEST_FILES.length;
        const testArgs = bunTestArgs({
          fast: useSubset ? false : options.fast,
          timeoutMs: options.timeoutMs,
          bail: true,
          retry: 2,
          dots: quiet,
        });
        if (useSubset) {
          testArgs.push("--isolate", ...related);
        }
        steps.push({
          name: testName,
          cmd: ["bun", ...testArgs],
          silentOnSuccess: quiet,
        });
      }
    }
  }

  return steps;
}

async function runStepTracked(
  projectRoot: string,
  step: PipelineStep,
  gateQuiet: boolean
): Promise<GateResult> {
  if (step.skipped || step.cmd.length === 0) {
    return {
      name: step.name,
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  if (step.silentOnSuccess && gateQuiet) {
    return runGate(step.name, step.cmd, { cwd: projectRoot });
  }
  const proc = Bun.spawn(step.cmd, {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  return { name: step.name, exitCode, ms: 0, stdout: "", stderr: "" };
}

async function runStepTrackedWithActive(
  projectRoot: string,
  step: PipelineStep,
  gateQuiet: boolean,
  active: SpawnedProcess[]
): Promise<GateResult> {
  if (step.skipped || step.cmd.length === 0) {
    return {
      name: step.name,
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  if (step.silentOnSuccess && gateQuiet) {
    return runGate(step.name, step.cmd, { cwd: projectRoot });
  }
  const start = Bun.nanoseconds();
  const proc = Bun.spawn(step.cmd, { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  active.push(proc);
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return {
    name: step.name,
    exitCode,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout,
    stderr,
  };
}

async function runStepsParallel(
  projectRoot: string,
  steps: PipelineStep[],
  gateQuiet: boolean,
  failFast: boolean
): Promise<GateResult[]> {
  if (!failFast) {
    return Promise.all(steps.map((step) => runStepTracked(projectRoot, step, gateQuiet)));
  }

  const active: SpawnedProcess[] = [];
  const results: GateResult[] = [];
  const runners = steps.map(async (step) => {
    const result = await runStepTrackedWithActive(projectRoot, step, gateQuiet, active);
    results.push(result);
    if (result.exitCode !== 0) {
      for (const proc of active) {
        if (proc.exitCode === null) proc.kill();
      }
      throw result;
    }
    return result;
  });

  try {
    await Promise.all(runners);
  } catch {
    // fail-fast partial results in `results`
  }
  return results;
}

export async function resolveChangedFilesForOptions(
  projectRoot: string,
  options: CheckOptions
): Promise<string[] | null> {
  const { changedFiles } = await resolveChangedContext(projectRoot, options);
  return changedFiles;
}

async function recordScopedGatePasses(
  projectRoot: string,
  options: CheckOptions,
  changedFiles: string[] | null,
  baseRef: string | null,
  results: GateResult[]
): Promise<void> {
  if (!options.changedOnly || !baseRef || !changedFiles || changedFiles.length === 0) return;

  for (const result of results) {
    if (result.skipped || result.exitCode !== 0) continue;

    if (result.name === "format:check") {
      const formatPaths = filterFormatPaths(changedFiles);
      if (formatPaths.length > 0) {
        await writeScopedGatePass(projectRoot, "format:check", formatPaths, baseRef, changedFiles);
      }
    } else if (result.name === "lint" && shouldRunScopedLint(changedFiles)) {
      await writeScopedGatePass(projectRoot, "lint", changedFiles, baseRef, changedFiles);
    } else if (result.name === "typecheck" && changedIncludesTypeScript(changedFiles)) {
      await writeScopedGatePass(projectRoot, "typecheck", [SCOPED_ANY_TS], baseRef, changedFiles);
    } else if (result.name === "test:fast" || result.name === "test") {
      await writeScopedGatePass(projectRoot, "test:fast", changedFiles, baseRef, changedFiles);
    }
  }
}

export async function runCheckPipeline(
  projectRoot: string,
  options: CheckOptions
): Promise<CheckRunResult> {
  const { changedFiles, baseRef } = await resolveChangedContext(projectRoot, options);
  const steps = await buildSteps(projectRoot, options, changedFiles, baseRef);
  const gateQuiet = (!options.verbose && shouldSilentOnSuccess()) || options.jsonSummary;

  const testStep = steps.find((step) => step.name === "test" || step.name === "test:fast");
  const independentSteps = steps.filter((step) => step !== testStep);
  const independentResults = await runStepsParallel(
    projectRoot,
    independentSteps,
    gateQuiet,
    options.failFast
  );

  const allResults = [...independentResults];
  if (testStep) {
    allResults.push(await runStepTracked(projectRoot, testStep, gateQuiet));
  }

  await recordScopedGatePasses(projectRoot, options, changedFiles, baseRef, allResults);

  return buildCheckResult(allResults);
}

export async function runTestOnlyPipeline(
  projectRoot: string,
  options: CheckOptions
): Promise<CheckRunResult> {
  const testOptions: CheckOptions = { ...options, skipTests: false };
  const { changedFiles, baseRef } = await resolveChangedContext(projectRoot, testOptions);
  const steps = await buildSteps(projectRoot, testOptions, changedFiles, baseRef);
  const testStep = steps.find((step) => step.name === "test" || step.name === "test:fast");
  if (!testStep) {
    return { passed: true, steps: {}, failures: [], totalDurationMs: 0 };
  }
  const gateQuiet = (!testOptions.verbose && shouldSilentOnSuccess()) || testOptions.jsonSummary;
  const result = await runStepTracked(projectRoot, testStep, gateQuiet);
  await recordScopedGatePasses(projectRoot, testOptions, changedFiles, baseRef, [result]);
  return buildCheckResult([result]);
}

export function printCheckDryRun(
  options: CheckOptions,
  steps: PipelineStep[],
  changedFiles: string[] | null
): void {
  const flags: string[] = [];
  if (options.staged) flags.push("staged");
  if (options.fast) flags.push("fast");
  if (options.changedOnly) flags.push(`changed-only base=${options.base}`);
  if (options.failFast) flags.push("fail-fast");
  if (options.skipTests) flags.push("skip-tests");
  if (options.jsonSummary) flags.push("json-summary");
  if (options.cacheResults) flags.push("cache-results");
  if (options.noCache) flags.push("no-cache");
  if (options.watch) flags.push("watch");
  if (options.watchTests) flags.push("watch-tests");
  const quiet = !options.verbose && shouldSilentOnSuccess() ? "(quiet) " : "";
  checkOut(`check (${flags.join(" ")}) ${quiet}— dry run`);
  checkOut(`  test timeout: ${options.timeoutMs}ms`);
  if (changedFiles) {
    checkOut(`  changed files: ${changedFiles.length}`);
  }
  for (const step of steps) {
    if (step.skipped) {
      checkOut(`  → (skip) ${step.name}`);
      continue;
    }
    checkOut(`  → ${step.cmd.join(" ")}`);
  }
}

export function printCheckResult(result: CheckRunResult, options: CheckOptions): void {
  if (options.jsonSummary) {
    checkOut(
      JSON.stringify({
        passed: result.passed,
        steps: result.steps,
        totalDurationMs: result.totalDurationMs,
      })
    );
    return;
  }

  if (result.passed) {
    const suffix = result.fromCache ? " (cached)" : "";
    checkOut(`✓ gate passed${suffix}`);
    return;
  }

  if (result.failures.length > 0 && !options.watch) {
    const first = result.failures[0]!;
    checkErr(`✗ gate failed: ${first.step} — ${first.message}`);
    return;
  }

  for (const failure of result.failures) {
    emitGateFailure({
      name: failure.step,
      exitCode: 1,
      ms: 0,
      stdout: "",
      stderr: failure.message,
    });
  }
}

export async function prepareDryRunSteps(
  projectRoot: string,
  options: CheckOptions
): Promise<{ steps: PipelineStep[]; changedFiles: string[] | null }> {
  const { changedFiles, baseRef } = await resolveChangedContext(projectRoot, options);
  const steps = await buildSteps(projectRoot, options, changedFiles, baseRef);
  return { steps, changedFiles };
}
