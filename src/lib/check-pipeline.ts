/**
 * Core check gate pipeline — build steps, run, and format results.
 */

import { buildBunTestArgBatches, buildBunTestArgs } from "./test-runtime.ts";
import {
  emitGateFailure,
  runGate,
  shouldSilentOnSuccess,
  fastGateTimeoutBudgetMs,
  type GateResult,
} from "./gate-runner.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";
import { withBunNoOrphans } from "./tool-runner.ts";
import {
  changedIncludesTypeScript,
  countLikelyErrors,
  filterFormatPaths,
  formatChangedOnlyBanner,
  formatChangedOnlyEmptyWarning,
  resolveChangedContext,
} from "./check-changed.ts";
import { shouldRunScopedLint } from "./check-lint-scoped.ts";
import { SCOPED_ANY_TS, writeScopedGatePass } from "./scoped-gate-cache.ts";
import { isKimiToolchainRepo } from "./workspace-health.ts";
import { pathExists } from "./bun-io.ts";
import type { CheckFailure, CheckOptions, CheckRunResult, StepSummary } from "./check-types.ts";
import { join } from "path";

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
  cmds?: string[][];
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

  if (await isKimiToolchainRepo(projectRoot)) {
    steps.push({
      name: "references:lint",
      cmd: ["bun", "run", "references:lint"],
      silentOnSuccess: quiet,
    });
    steps.push({
      name: "secrets-storage-gate",
      cmd: ["bun", "run", "scripts/secrets-storage-gate.ts"],
      silentOnSuccess: quiet,
    });
    if (pathExists(join(projectRoot, "scripts", "check-env-drift.ts"))) {
      steps.push({
        name: "check:env-drift",
        cmd: ["bun", "run", "scripts/check-env-drift.ts"],
        silentOnSuccess: quiet,
      });
    }
  }

  if (options.fast && (await isKimiToolchainRepo(projectRoot))) {
    steps.push({
      name: "verify:bun-features",
      cmd: ["bun", "scripts/verify-bun-features.ts"],
      silentOnSuccess: quiet,
    });
    if (pathExists(join(projectRoot, "scripts", "autophagy-scan.ts"))) {
      steps.push({
        name: "autophagy:scan",
        cmd: ["bun", "scripts/autophagy-scan.ts", "--brief"],
        silentOnSuccess: false,
      });
    }
  }

  if (options.fast && pathExists(join(projectRoot, "scripts", "scan.ts"))) {
    const scanCmd = ["bun", "run", "scripts/scan.ts", "--brief"];
    if (options.scanStrict) scanCmd.push("--exit-code");
    steps.push({
      name: "scan",
      cmd: scanCmd,
      silentOnSuccess: false,
    });
  }

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
      cmd: ["bun", "run", "lint", "--files", ...changedFiles],
      silentOnSuccess: quiet,
    });
  } else if (options.fast) {
    steps.push({
      name: "lint",
      cmd: ["bun", "run", "lint", "--names-only"],
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
      const testArgs = buildBunTestArgs({
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
      const testArgBatches = buildBunTestArgBatches({
        fast: options.fast,
        timeoutMs: options.timeoutMs,
        bail: true,
        retry: 2,
        dots: quiet,
      });
      const testCmds = testArgBatches.map((args) => ["bun", ...args]);
      steps.push({
        name: testName,
        cmd: testCmds[0] ?? [],
        ...(testCmds.length > 1 ? { cmds: testCmds } : {}),
        silentOnSuccess: quiet,
      });
    }
  }

  return steps;
}

function stepCommands(step: PipelineStep): string[][] {
  if (step.cmds?.length) return step.cmds;
  return step.cmd.length ? [step.cmd] : [];
}

async function runStepCommandSequence(
  projectRoot: string,
  step: PipelineStep
): Promise<GateResult> {
  const commands = stepCommands(step);
  const started = Bun.nanoseconds();
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]!;
    const chunkName = commands.length > 1 ? `${step.name}:${i + 1}/${commands.length}` : step.name;
    const result = await runGate(chunkName, command, { cwd: projectRoot });
    stdoutParts.push(result.stdout);
    stderrParts.push(result.stderr);
    if (result.exitCode !== 0) {
      return {
        name: step.name,
        exitCode: result.exitCode,
        ms: Math.round((Bun.nanoseconds() - started) / 1_000_000),
        stdout: stdoutParts.filter(Boolean).join("\n"),
        stderr: stderrParts.filter(Boolean).join("\n"),
      };
    }
  }

  return {
    name: step.name,
    exitCode: 0,
    ms: Math.round((Bun.nanoseconds() - started) / 1_000_000),
    stdout: stdoutParts.filter(Boolean).join("\n"),
    stderr: stderrParts.filter(Boolean).join("\n"),
  };
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
  if (gateQuiet) {
    return runStepCommandSequence(projectRoot, step);
  }
  const start = Bun.nanoseconds();
  for (const command of stepCommands(step)) {
    const proc = Bun.spawn(withBunNoOrphans(command), {
      cwd: projectRoot,
      stdout: "inherit",
      stderr: "inherit",
      env: withNoOrphansEnv(),
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return {
        name: step.name,
        exitCode,
        ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
        stdout: "",
        stderr: "",
      };
    }
  }
  return {
    name: step.name,
    exitCode: 0,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout: "",
    stderr: "",
  };
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
  if (gateQuiet) {
    return runStepCommandSequence(projectRoot, step);
  }
  const start = Bun.nanoseconds();
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let exitCode = 0;

  for (const command of stepCommands(step)) {
    const proc = Bun.spawn(withBunNoOrphans(command), {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: withNoOrphansEnv(),
    });
    active.push(proc);
    const [stdout, stderr, code] = await Promise.all([
      readableStreamToText(proc.stdout),
      readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    stdoutParts.push(stdout);
    stderrParts.push(stderr);
    exitCode = code;
    if (code !== 0) break;
  }

  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);
  const stdout = stdoutParts.filter(Boolean).join("\n");
  const stderr = stderrParts.filter(Boolean).join("\n");

  const budget = fastGateTimeoutBudgetMs();
  if (budget > 0 && ms > budget && exitCode === 0) {
    const budgetMsg = `TIMEOUT: ${step.name} took ${ms}ms, budget is ${budget}ms`;
    return {
      name: step.name,
      exitCode: 1,
      ms,
      stdout,
      stderr: [stderr, budgetMsg].filter(Boolean).join("\n"),
    };
  }

  return { name: step.name, exitCode, ms, stdout, stderr };
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

function dryRunResultFromSteps(steps: PipelineStep[]): CheckRunResult {
  return buildCheckResult(
    steps.map((step) => ({
      name: step.name,
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    }))
  );
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
): Promise<number> {
  if (!options.changedOnly || !baseRef || !changedFiles || changedFiles.length === 0) return 0;

  let recorded = 0;
  for (const result of results) {
    if (result.skipped || result.exitCode !== 0) continue;

    if (result.name === "format:check") {
      const formatPaths = filterFormatPaths(changedFiles);
      if (formatPaths.length > 0) {
        await writeScopedGatePass(projectRoot, "format:check", formatPaths, baseRef, changedFiles);
        recorded++;
      }
    } else if (result.name === "lint" && shouldRunScopedLint(changedFiles)) {
      await writeScopedGatePass(projectRoot, "lint", changedFiles, baseRef, changedFiles);
      recorded++;
    } else if (result.name === "typecheck" && changedIncludesTypeScript(changedFiles)) {
      await writeScopedGatePass(projectRoot, "typecheck", [SCOPED_ANY_TS], baseRef, changedFiles);
      recorded++;
    } else if (result.name === "test:fast" || result.name === "test") {
      await writeScopedGatePass(projectRoot, "test:fast", changedFiles, baseRef, changedFiles);
      recorded++;
    }
  }
  return recorded;
}

export async function runCheckPipeline(
  projectRoot: string,
  options: CheckOptions
): Promise<CheckRunResult> {
  const { changedFiles, baseRef, baseLabel } = await resolveChangedContext(projectRoot, options);

  if (
    options.changedOnly &&
    changedFiles &&
    !options.jsonSummary &&
    !options.dryRun &&
    !options.verbose
  ) {
    if (changedFiles.length === 0 && baseLabel) {
      checkErr(formatChangedOnlyEmptyWarning(baseLabel));
    } else if (changedFiles.length > 0 && baseLabel) {
      checkOut(formatChangedOnlyBanner(changedFiles, baseLabel));
    }
  }

  const steps = await buildSteps(projectRoot, options, changedFiles, baseRef);

  if (options.dryRun) {
    if (!options.jsonSummary) printCheckDryRun(options, steps, changedFiles, baseLabel);
    return dryRunResultFromSteps(steps);
  }

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

  const scopedGatesRecorded = await recordScopedGatePasses(
    projectRoot,
    options,
    changedFiles,
    baseRef,
    allResults
  );

  return { ...buildCheckResult(allResults), scopedGatesRecorded };
}

export async function runTestOnlyPipeline(
  projectRoot: string,
  options: CheckOptions
): Promise<CheckRunResult> {
  const testOptions: CheckOptions = { ...options, skipTests: false };
  const { changedFiles, baseRef, baseLabel } = await resolveChangedContext(
    projectRoot,
    testOptions
  );

  if (
    testOptions.changedOnly &&
    changedFiles &&
    !testOptions.jsonSummary &&
    !testOptions.dryRun &&
    !testOptions.verbose
  ) {
    if (changedFiles.length === 0 && baseLabel) {
      checkErr(formatChangedOnlyEmptyWarning(baseLabel));
    } else if (changedFiles.length > 0 && baseLabel) {
      checkOut(formatChangedOnlyBanner(changedFiles, baseLabel));
    }
  }

  const steps = await buildSteps(projectRoot, testOptions, changedFiles, baseRef);
  const testStep = steps.find((step) => step.name === "test" || step.name === "test:fast");

  if (testOptions.dryRun) {
    const dryRunSteps = testStep ? [testStep] : [];
    if (!testOptions.jsonSummary)
      printCheckDryRun(testOptions, dryRunSteps, changedFiles, baseLabel);
    return dryRunResultFromSteps(dryRunSteps);
  }

  if (!testStep) {
    return { passed: true, steps: {}, failures: [], totalDurationMs: 0 };
  }
  const gateQuiet = (!testOptions.verbose && shouldSilentOnSuccess()) || testOptions.jsonSummary;
  const result = await runStepTracked(projectRoot, testStep, gateQuiet);
  const scopedGatesRecorded = await recordScopedGatePasses(
    projectRoot,
    testOptions,
    changedFiles,
    baseRef,
    [result]
  );
  return { ...buildCheckResult([result]), scopedGatesRecorded };
}

export function printCheckDryRun(
  options: CheckOptions,
  steps: PipelineStep[],
  changedFiles: string[] | null,
  baseLabel: string | null = null
): void {
  const flags: string[] = [];
  if (options.staged) flags.push("staged");
  if (options.fast) flags.push("fast");
  if (options.changedOnly) flags.push(`changed-only base=${baseLabel ?? options.base}`);
  if (options.failFast) flags.push("fail-fast");
  if (options.skipTests) flags.push("skip-tests");
  if (options.jsonSummary) flags.push("json-summary");
  if (options.cacheResults) flags.push("cache-results");
  if (options.noCache) flags.push("no-cache");
  if (options.watch) flags.push("watch");
  if (options.watchTests) flags.push("watch-tests");
  if (options.scanStrict) flags.push("scan-strict");
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
    const commands = stepCommands(step);
    if (commands.length <= 1) {
      checkOut(`  → ${step.name}: ${step.cmd.join(" ")}`);
      continue;
    }
    checkOut(`  → ${step.name} (${commands.length} chunks)`);
    for (const [i, command] of commands.entries()) {
      checkOut(`    ${i + 1}. ${command.join(" ")}`);
    }
  }
}

export function printCheckResult(result: CheckRunResult, options: CheckOptions): void {
  if (options.jsonSummary) {
    const output: Record<string, unknown> = {
      passed: result.passed,
      steps: result.steps,
      totalDurationMs: result.totalDurationMs,
    };
    if (options.profile) {
      output.profile = Object.entries(result.steps).map(([step, s]) => ({
        step,
        durationMs: s.durationMs,
        passed: s.passed,
        skipped: s.skipped ?? false,
        ...(s.errors !== undefined ? { errors: s.errors } : {}),
      }));
    }
    checkOut(JSON.stringify(output));
    return;
  }

  const printProfile = () => {
    if (!options.profile) return;
    const entries = Object.entries(result.steps);
    if (entries.length === 0) return;
    const maxName = Math.max(...entries.map(([name]) => name.length));
    const total = entries.reduce((sum, [, s]) => sum + s.durationMs, 0);
    const pad = (n: number) => String(n).padStart(5);
    checkOut("");
    for (const [name, s] of entries) {
      const mark = s.skipped ? "—" : s.passed ? "✓" : "✗";
      const ms = s.durationMs > 0 ? `${pad(s.durationMs)}ms` : "     —";
      checkOut(`  ${name.padEnd(maxName)}  ${ms}  ${mark}`);
    }
    checkOut(`  ${"─".repeat(maxName + 14)}`);
    checkOut(`  ${"total".padEnd(maxName)}  ${pad(total)}ms`);
  };

  if (result.passed) {
    const hints: string[] = [];
    if (result.fromCache) hints.push("cached");
    if (result.scopedGatesRecorded && result.scopedGatesRecorded > 0) {
      hints.push(`scoped cache +${result.scopedGatesRecorded}`);
    }
    const duration =
      result.totalDurationMs > 0 ? ` [${(result.totalDurationMs / 1000).toFixed(2)}s]` : "";
    const suffix = hints.length > 0 ? ` (${hints.join(", ")})${duration}` : duration;
    checkOut(`✓ gate passed${suffix}`);
    printProfile();
    return;
  }

  printProfile();

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
): Promise<{
  steps: PipelineStep[];
  changedFiles: string[] | null;
  baseLabel: string | null;
}> {
  const { changedFiles, baseRef, baseLabel } = await resolveChangedContext(projectRoot, options);
  const steps = await buildSteps(projectRoot, options, changedFiles, baseRef);
  return { steps, changedFiles, baseLabel };
}
