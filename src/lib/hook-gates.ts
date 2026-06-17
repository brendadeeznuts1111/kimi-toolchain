/**
 * Pre-commit / pre-push gate orchestration for kimi-githooks run-gates.
 */

import { makeDir, pathExists } from "./bun-io.ts";

import { join } from "path";
import { $ } from "bun";
import {
  emitGateFailure,
  emitHookSummary,
  formatTestSummaryLine,
  hookUsesSummary,
  runGate,
  appendGateCache,
  shouldSkipGate,
  type GateResult,
} from "./gate-runner.ts";
import { isQuietMode } from "./quiet-mode.ts";
import { isKimiToolchainRepo } from "./workspace-health.ts";
import { readPackageJson, sha256File } from "./utils.ts";
import { buildConstantRepairPlan } from "./constants-heal.ts";
import { detectSyncDrift } from "./sync-hashes.ts";
import { desktopRuntimeDepsOk } from "./desktop-runtime-deps.ts";
import { listStagedPaths } from "./scoped-test-cache.ts";
import {
  allPreCommitGatesCoveredAtHead,
  shouldSkipGateFromScopedCache,
} from "./scoped-gate-cache.ts";

const PRE_COMMIT_CACHE_GATES = ["format:check", "lint", "typecheck", "test:fast"] as const;
const PRE_PUSH_CACHE_GATES = [
  "guardian",
  "constant-drift",
  "effect-gates",
  "r-score",
  "install-wrappers",
  "workspace-verify",
  "sync",
  "sync:verify",
] as const;
const WRAPPER_HASH_PATH = ".kimi/.wrapper-input-hash";

export interface PlannedGate {
  name: string;
  cmd: string[];
  skipped: boolean;
}

export interface PreCommitPolicyAudit {
  ok: boolean;
  messages: string[];
}

async function packageHasScript(projectRoot: string, script: string): Promise<boolean> {
  const pkg = await readPackageJson<{ scripts?: Record<string, string> }>(projectRoot);
  return typeof pkg?.scripts?.[script] === "string";
}

function gateOut(message: string): void {
  Bun.stdout.write(`${message}\n`);
}

function gateErr(message: string): void {
  Bun.stderr.write(`${message}\n`);
}

function gateWarn(message: string): void {
  Bun.stderr.write(`${message}\n`);
}

async function runGateVisible(
  projectRoot: string,
  name: string,
  cmd: string[]
): Promise<GateResult> {
  const start = Bun.nanoseconds();
  if (!hookUsesSummary()) {
    const proc = Bun.spawn(cmd, {
      cwd: projectRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return {
      name,
      exitCode,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: "",
      stderr: "",
    };
  }
  const result = await runGate(name, cmd, { cwd: projectRoot });
  return result;
}

function printVerboseBanner(title: string): void {
  if (isQuietMode()) return;
  gateOut(`── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

function skippedGateResult(name: string): GateResult {
  return { name, exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
}

export async function runPreCommitGates(projectRoot: string): Promise<number> {
  const summary = hookUsesSummary();
  const results: GateResult[] = [];
  const staged = await listStagedPaths(projectRoot);

  const gates: Array<() => Promise<GateResult | null>> = [
    async () => {
      if (!(await packageHasScript(projectRoot, "format:check"))) return null;
      if (!summary) printVerboseBanner("Format check");
      if (await shouldSkipGate(projectRoot, "format:check"))
        return skippedGateResult("format:check");
      if (await shouldSkipGateFromScopedCache(projectRoot, "format:check", staged)) {
        return skippedGateResult("format:check");
      }
      return runGateVisible(projectRoot, "format:check", ["bun", "run", "format:check"]);
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "lint"))) return null;
      if (!summary) printVerboseBanner("Lint");
      if (await shouldSkipGate(projectRoot, "lint")) return skippedGateResult("lint");
      if (await shouldSkipGateFromScopedCache(projectRoot, "lint", staged)) {
        return skippedGateResult("lint");
      }
      return runGateVisible(projectRoot, "lint", ["bun", "run", "lint"]);
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "typecheck"))) return null;
      if (!summary) printVerboseBanner("Type check");
      if (await shouldSkipGate(projectRoot, "typecheck")) return skippedGateResult("typecheck");
      if (await shouldSkipGateFromScopedCache(projectRoot, "typecheck", staged)) {
        return skippedGateResult("typecheck");
      }
      return runGateVisible(projectRoot, "typecheck", ["bun", "run", "typecheck"]);
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "test:fast"))) return null;
      if (!summary) printVerboseBanner("Unit tests (fast)");
      if (await shouldSkipGate(projectRoot, "test:fast")) return skippedGateResult("test:fast");
      if (await shouldSkipGateFromScopedCache(projectRoot, "test:fast", staged)) {
        return skippedGateResult("test:fast");
      }
      return runGateVisible(projectRoot, "test:fast", ["bun", "run", "test:fast"]);
    },
    async () => {
      const tuning = join(projectRoot, "scripts/lint-tuning-set-version.ts");
      if (!pathExists(tuning)) return null;
      if (!summary) printVerboseBanner("Tuning set version");
      return runGateVisible(projectRoot, "tuning-set", [
        "bun",
        "run",
        "scripts/lint-tuning-set-version.ts",
        "--staged",
      ]);
    },
  ];

  for (const run of gates) {
    const result = await run();
    if (!result) continue;
    results.push(result);
    if (result.exitCode !== 0) {
      if (summary) emitHookSummary("pre-commit", results);
      else emitGateFailure(result);
      return result.exitCode;
    }
  }

  const succeeded = results.filter((item) => item.exitCode === 0);
  const cacheable = PRE_COMMIT_CACHE_GATES.filter((gate) =>
    succeeded.some((item) => item.name === gate)
  );
  if (cacheable.length > 0) await appendGateCache(projectRoot, [...cacheable]);

  if (summary) emitHookSummary("pre-commit", results);
  return 0;
}

async function runGuardianGate(projectRoot: string): Promise<GateResult> {
  const guardian = pathExists(join(projectRoot, "src/bin/kimi-guardian.ts"))
    ? join(projectRoot, "src/bin/kimi-guardian.ts")
    : null;
  if (!guardian) {
    return { name: "guardian", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  if (await shouldSkipGate(projectRoot, "guardian")) {
    return { name: "guardian", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  const result = await runGateVisible(projectRoot, "guardian", ["bun", "run", guardian, "check"]);
  if (result.exitCode !== 0) return result;

  const critical = [result.stdout, result.stderr]
    .join("\n")
    .split("\n")
    .filter((line) => /CVE|outdated|untrusted|HASH MISMATCH/i.test(line));
  if (critical.length > 0) {
    return { ...result, exitCode: 1, stderr: critical.join("\n") };
  }
  return result;
}

export async function runConstantDriftGate(projectRoot: string): Promise<GateResult> {
  if (Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE === "1") {
    return {
      name: "constant-drift",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }

  if (!(await isKimiToolchainRepo(projectRoot))) {
    return {
      name: "constant-drift",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }

  if (await shouldSkipGate(projectRoot, "constant-drift")) {
    return {
      name: "constant-drift",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }

  const start = Bun.nanoseconds();
  const plan = await buildConstantRepairPlan(projectRoot);

  if (plan.goldenVersion === "missing") {
    return {
      name: "constant-drift",
      exitCode: 0,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: "golden template missing — run: kimi-heal constants snapshot",
      stderr: "",
      skipped: true,
    };
  }

  if (plan.repairCount > 0) {
    const keys = [...plan.diff.missingKeys, ...plan.diff.invalidKeys.map((item) => item.key)];
    return {
      name: "constant-drift",
      exitCode: 1,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: "",
      stderr: `PUSH BLOCKED: constant drift (${plan.repairCount} key(s): ${keys.join(", ")}) — kimi-heal repair-constants --dry-run`,
    };
  }

  return {
    name: "constant-drift",
    exitCode: 0,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout: "bunfig [define] matches golden template",
    stderr: "",
  };
}

async function wrapperInputHash(projectRoot: string): Promise<string | null> {
  const hasher = new Bun.CryptoHasher("sha256");
  const paths = [
    join(projectRoot, "package.json"),
    join(projectRoot, "scripts/install-bin-wrappers.sh"),
    join(projectRoot, "src/lib/herdr-agents.ts"),
  ];
  for (const path of paths) {
    if (!pathExists(path)) return null;
    hasher.update(await sha256File(path));
  }
  return hasher.digest("hex");
}

async function shouldSkipWrapperInstall(projectRoot: string): Promise<boolean> {
  if (await shouldSkipGate(projectRoot, "install-wrappers")) return true;
  const marker = join(projectRoot, WRAPPER_HASH_PATH);
  const current = await wrapperInputHash(projectRoot);
  if (!current || !pathExists(marker)) return false;
  return (await Bun.file(marker).text()).trim() === current;
}

async function writeWrapperInputHash(projectRoot: string): Promise<void> {
  const current = await wrapperInputHash(projectRoot);
  if (!current) return;
  makeDir(join(projectRoot, ".kimi"), { recursive: true });
  await Bun.write(join(projectRoot, WRAPPER_HASH_PATH), `${current}\n`);
}

function mergePushGateResults(results: GateResult[], batch: GateResult[]): number | null {
  for (const result of batch) {
    results.push(result);
    if (result.exitCode !== 0) return result.exitCode;
  }
  return null;
}

async function runRScoreGate(projectRoot: string): Promise<GateResult> {
  const governance = pathExists(join(projectRoot, "src/bin/kimi-governance.ts"))
    ? join(projectRoot, "src/bin/kimi-governance.ts")
    : null;
  if (!governance) {
    return { name: "r-score", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  if (await shouldSkipGate(projectRoot, "r-score")) {
    return { name: "r-score", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  const result = await runGateVisible(projectRoot, "r-score", [
    "bun",
    "run",
    governance,
    "score",
    "--quick",
    "--hook",
  ]);
  const gradeLine = [result.stdout, result.stderr].join("\n").match(/Grade:\s*([A-F])/);
  const grade = gradeLine?.[1];
  if (grade === "F" || grade === "D") {
    return {
      ...result,
      exitCode: 1,
      stderr: `PUSH BLOCKED: R-Score is ${grade}. Run: bun run ${governance} score --preflight`,
    };
  }
  return result;
}

async function runEffectGatesGate(projectRoot: string): Promise<GateResult> {
  if (Bun.env.KIMI_SKIP_EFFECT_GATES === "1") {
    return {
      name: "effect-gates",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  if (await shouldSkipGate(projectRoot, "effect-gates")) {
    return {
      name: "effect-gates",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }

  const doctor = pathExists(join(projectRoot, "src/bin/kimi-doctor.ts"))
    ? join(projectRoot, "src/bin/kimi-doctor.ts")
    : null;
  if (!doctor) {
    return { name: "effect-gates", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  return runGateVisible(projectRoot, "effect-gates", ["bun", "run", doctor, "--effect-gates"]);
}

async function runCheckFastGate(projectRoot: string): Promise<GateResult> {
  const full = Bun.env.KIMI_PRE_PUSH_FULL === "1";
  const script = full ? "check" : "check:fast";
  if (!(await packageHasScript(projectRoot, script))) {
    return { name: script, exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  if (!full && (await qualityGatesCached(projectRoot))) {
    return {
      name: "check:fast",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  return runGateVisible(projectRoot, full ? "check" : "check:fast", ["bun", "run", script]);
}

async function runInstallWrappersGate(projectRoot: string): Promise<GateResult> {
  const installer = join(projectRoot, "scripts/install-bin-wrappers.sh");
  if (!pathExists(installer)) {
    return {
      name: "install-wrappers",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  if (await shouldSkipWrapperInstall(projectRoot)) {
    return {
      name: "install-wrappers",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  const result = await runGateVisible(projectRoot, "install-wrappers", [
    "bash",
    "scripts/install-bin-wrappers.sh",
  ]);
  if (result.exitCode === 0) await writeWrapperInputHash(projectRoot);
  return result;
}

async function runSyncGate(projectRoot: string): Promise<GateResult> {
  if (await shouldSkipGate(projectRoot, "sync")) {
    return { name: "sync", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  const start = Bun.nanoseconds();
  const [report, depsOk] = await Promise.all([
    detectSyncDrift(projectRoot),
    Promise.resolve(desktopRuntimeDepsOk()),
  ]);
  if (report.synced && depsOk) {
    return {
      name: "sync",
      exitCode: 0,
      ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
      stdout: "desktop runtime already in sync",
      stderr: "",
      skipped: true,
    };
  }
  const sync = pathExists(join(projectRoot, "scripts/sync-to-desktop.ts"))
    ? ["bun", "run", "scripts/sync-to-desktop.ts"]
    : ["bun", "run", "sync"];
  return runGateVisible(projectRoot, "sync", sync);
}

async function runSyncVerifyGate(
  projectRoot: string,
  options: { syncSkipped?: boolean } = {}
): Promise<GateResult> {
  if (options.syncSkipped) {
    return {
      name: "sync:verify",
      exitCode: 0,
      ms: 0,
      stdout: "sync skipped — verify not needed",
      stderr: "",
      skipped: true,
    };
  }
  if (await shouldSkipGate(projectRoot, "sync:verify")) {
    return { name: "sync:verify", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  return runGateVisible(projectRoot, "sync:verify", ["bun", "run", "sync:verify"]);
}

async function runWorkspaceVerifyGate(projectRoot: string): Promise<GateResult> {
  if (await shouldSkipGate(projectRoot, "workspace-verify")) {
    return {
      name: "workspace-verify",
      exitCode: 0,
      ms: 0,
      stdout: "",
      stderr: "",
      skipped: true,
    };
  }
  const verify = pathExists(join(projectRoot, "scripts/verify-workspace.sh"))
    ? ["bash", "scripts/verify-workspace.sh"]
    : ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"];
  return runGateVisible(projectRoot, "workspace-verify", verify);
}

/** True when desktop sync will copy files (verify must run afterward). */
export async function syncWillWrite(projectRoot: string): Promise<boolean> {
  if (await shouldSkipGate(projectRoot, "sync")) return false;
  const [report, depsOk] = await Promise.all([
    detectSyncDrift(projectRoot),
    Promise.resolve(desktopRuntimeDepsOk()),
  ]);
  return !report.synced || !depsOk;
}

/** Parallel pre-push by default; set KIMI_PRE_PUSH_SERIAL=1 on memory-constrained hosts. */
export function prePushRunsInParallel(): boolean {
  return Bun.env.KIMI_PRE_PUSH_SERIAL !== "1";
}

async function runPrePushGatesSerial(
  projectRoot: string,
  summary: boolean
): Promise<{
  results: GateResult[];
  fail: number | null;
}> {
  const results: GateResult[] = [];

  if (!summary) printVerboseBanner("Security + discipline");
  let fail = mergePushGateResults(
    results,
    await Promise.all([
      runGuardianGate(projectRoot),
      runConstantDriftGate(projectRoot),
      runEffectGatesGate(projectRoot),
    ])
  );
  if (fail !== null) return { results, fail };

  if (!summary) printVerboseBanner("Quality");
  fail = mergePushGateResults(
    results,
    await Promise.all([runRScoreGate(projectRoot), runCheckFastGate(projectRoot)])
  );
  return { results, fail };
}

async function runPrePushToolchainGates(
  projectRoot: string,
  summary: boolean,
  results: GateResult[],
  parallel: boolean
): Promise<number | null> {
  if (!summary) printVerboseBanner("Toolchain runtime");

  if (parallel) {
    const needsSyncWrite = await syncWillWrite(projectRoot);
    const runners: Array<() => Promise<GateResult>> = [
      () => runInstallWrappersGate(projectRoot),
      () => runWorkspaceVerifyGate(projectRoot),
      () => runSyncGate(projectRoot),
    ];
    const fail = mergePushGateResults(results, await Promise.all(runners.map((run) => run())));
    if (fail !== null) return fail;
    if (!needsSyncWrite) return null;

    const syncVerify = await runSyncVerifyGate(projectRoot);
    results.push(syncVerify);
    return syncVerify.exitCode !== 0 ? syncVerify.exitCode : null;
  }

  const wrapper = await runInstallWrappersGate(projectRoot);
  results.push(wrapper);
  if (wrapper.exitCode !== 0) return wrapper.exitCode;

  const workspace = await runWorkspaceVerifyGate(projectRoot);
  results.push(workspace);
  if (workspace.exitCode !== 0) return workspace.exitCode;

  const sync = await runSyncGate(projectRoot);
  results.push(sync);
  if (sync.exitCode !== 0) return sync.exitCode;
  if (sync.skipped) return null;

  const syncVerify = await runSyncVerifyGate(projectRoot);
  results.push(syncVerify);
  return syncVerify.exitCode !== 0 ? syncVerify.exitCode : null;
}

async function qualityGatesCached(projectRoot: string): Promise<boolean> {
  return await allPreCommitGatesCoveredAtHead(projectRoot);
}

export async function runPrePushGates(projectRoot: string): Promise<number> {
  const summary = hookUsesSummary();
  const results: GateResult[] = [];
  const isToolchain = await isKimiToolchainRepo(projectRoot);
  const parallel = prePushRunsInParallel();

  if (!summary) gateOut("═══ Kimi Pre-Push Gate ═══");

  const finishFailure = (code: number): number => {
    if (summary) emitHookSummary("pre-push", results);
    return code;
  };

  const noteSuccess = (result: GateResult) => {
    if (!summary && !result.skipped) {
      const testLine = formatTestSummaryLine(result.stdout);
      if (testLine) gateOut(`  ${testLine}`);
    }
  };

  let fail: number | null = null;

  if (parallel) {
    const needsSyncWrite = isToolchain && (await syncWillWrite(projectRoot));
    const runners: Array<() => Promise<GateResult>> = [
      () => runGuardianGate(projectRoot),
      () => runConstantDriftGate(projectRoot),
      () => runEffectGatesGate(projectRoot),
      () => runRScoreGate(projectRoot),
      () => runCheckFastGate(projectRoot),
    ];
    if (isToolchain) {
      runners.push(
        () => runInstallWrappersGate(projectRoot),
        () => runWorkspaceVerifyGate(projectRoot),
        () => runSyncGate(projectRoot)
      );
    }

    if (!summary) printVerboseBanner("Pre-push gates (parallel)");
    fail = mergePushGateResults(results, await Promise.all(runners.map((run) => run())));
    if (fail !== null) {
      if (!summary) emitGateFailure(results[results.length - 1]!);
      return finishFailure(fail);
    }
    for (const result of results) noteSuccess(result);

    if (isToolchain && needsSyncWrite) {
      const syncVerify = await runSyncVerifyGate(projectRoot);
      results.push(syncVerify);
      if (syncVerify.exitCode !== 0) {
        if (!summary) emitGateFailure(syncVerify);
        return finishFailure(syncVerify.exitCode);
      }
    }
  } else {
    const serial = await runPrePushGatesSerial(projectRoot, summary);
    results.push(...serial.results);
    fail = serial.fail;
    if (fail !== null) {
      if (!summary) emitGateFailure(results[results.length - 1]!);
      return finishFailure(fail);
    }
    for (const result of serial.results.slice(-2)) noteSuccess(result);

    if (isToolchain) {
      fail = await runPrePushToolchainGates(projectRoot, summary, results, false);
      if (fail !== null) {
        if (!summary) emitGateFailure(results[results.length - 1]!);
        return finishFailure(fail);
      }
    }
  }

  const cacheGates: string[] = [];
  const checkGate = results.find((item) => item.name === "check:fast" || item.name === "check");
  if (checkGate?.exitCode === 0 && !checkGate.skipped) {
    cacheGates.push(...PRE_COMMIT_CACHE_GATES);
  }
  for (const gate of PRE_PUSH_CACHE_GATES) {
    const item = results.find((entry) => entry.name === gate);
    if (item?.exitCode === 0 && !item.skipped) cacheGates.push(gate);
  }
  if (cacheGates.length > 0) await appendGateCache(projectRoot, cacheGates);

  if (summary) emitHookSummary("pre-push", results);
  else gateOut("\n✓ Pre-push checks passed");
  return 0;
}

/** Shell-hook policy checks (secrets, TODO warnings) — stays lightweight. */
export async function auditPreCommitPolicy(projectRoot: string): Promise<PreCommitPolicyAudit> {
  const messages: string[] = [];
  const result = await $`git diff --cached --name-only`.cwd(projectRoot).nothrow().quiet();
  const files = result.stdout.toString().trim().split("\n").filter(Boolean);

  const envFiles = files.filter((f) => /^\.env($|\.)/.test(f) && f !== ".env.example");
  if (envFiles.length > 0) {
    messages.push(
      `✗ Commit blocked: .env file detected in staged changes (${envFiles.join(", ")})`
    );
    return { ok: false, messages };
  }

  const nonTest = files.filter((f) => f && !/\.(test|spec)\./.test(f));
  if (nonTest.length > 0) {
    const diff = await $`git diff --cached -- ${nonTest}`.cwd(projectRoot).nothrow().quiet();
    const todoCount = diff.stdout
      .toString()
      .split("\n")
      .filter((line) => /^\+.*TODO|FIXME/.test(line)).length;
    if (todoCount > 0) {
      messages.push(`⚠ ${todoCount} TODO/FIXME found in staged non-test files`);
    }
  }

  if (messages.length === 0) {
    messages.push("✓ No staged .env files");
  }

  return { ok: true, messages };
}

export async function runPreCommitPolicy(projectRoot: string): Promise<number> {
  const audit = await auditPreCommitPolicy(projectRoot);
  for (const message of audit.messages) {
    if (message.startsWith("✗")) gateErr(message);
    else if (message.startsWith("⚠") && !isQuietMode()) gateWarn(message);
  }
  return audit.ok ? 0 : 1;
}

export async function planPreCommitGates(projectRoot: string): Promise<PlannedGate[]> {
  const planned: PlannedGate[] = [];

  if (await packageHasScript(projectRoot, "format:check")) {
    planned.push({
      name: "format:check",
      cmd: ["bun", "run", "format:check"],
      skipped: await shouldSkipGate(projectRoot, "format:check"),
    });
  }
  if (await packageHasScript(projectRoot, "lint")) {
    planned.push({
      name: "lint",
      cmd: ["bun", "run", "lint"],
      skipped: await shouldSkipGate(projectRoot, "lint"),
    });
  }
  if (await packageHasScript(projectRoot, "typecheck")) {
    planned.push({
      name: "typecheck",
      cmd: ["bun", "run", "typecheck"],
      skipped: await shouldSkipGate(projectRoot, "typecheck"),
    });
  }
  if (await packageHasScript(projectRoot, "test:fast")) {
    planned.push({
      name: "test:fast",
      cmd: ["bun", "run", "test:fast"],
      skipped: await shouldSkipGate(projectRoot, "test:fast"),
    });
  }
  if (pathExists(join(projectRoot, "scripts/lint-tuning-set-version.ts"))) {
    planned.push({
      name: "tuning-set",
      cmd: ["bun", "run", "scripts/lint-tuning-set-version.ts", "--staged"],
      skipped: false,
    });
  }

  return planned;
}

export async function planPrePushGates(projectRoot: string): Promise<PlannedGate[]> {
  const planned: PlannedGate[] = [];
  const isToolchain = await isKimiToolchainRepo(projectRoot);

  if (pathExists(join(projectRoot, "src/bin/kimi-guardian.ts"))) {
    planned.push({
      name: "guardian",
      cmd: ["bun", "run", "src/bin/kimi-guardian.ts", "check"],
      skipped: await shouldSkipGate(projectRoot, "guardian"),
    });
  }
  if (await isKimiToolchainRepo(projectRoot)) {
    planned.push({
      name: "constant-drift",
      cmd: ["constant-drift", "(internal gate)"],
      skipped:
        Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE === "1" ||
        (await shouldSkipGate(projectRoot, "constant-drift")),
    });
  }
  if (pathExists(join(projectRoot, "src/bin/kimi-governance.ts"))) {
    planned.push({
      name: "r-score",
      cmd: ["bun", "run", "src/bin/kimi-governance.ts", "score", "--quick", "--hook"],
      skipped: await shouldSkipGate(projectRoot, "r-score"),
    });
  }

  const full = Bun.env.KIMI_PRE_PUSH_FULL === "1";
  const script = full ? "check" : "check:fast";
  if (await packageHasScript(projectRoot, script)) {
    planned.push({
      name: script,
      cmd: ["bun", "run", script],
      skipped: !full && (await qualityGatesCached(projectRoot)),
    });
  }

  const doctor = pathExists(join(projectRoot, "src/bin/kimi-doctor.ts"))
    ? join(projectRoot, "src/bin/kimi-doctor.ts")
    : null;
  if (doctor) {
    planned.push({
      name: "effect-gates",
      cmd: ["bun", "run", doctor, "--effect-gates"],
      skipped:
        Bun.env.KIMI_SKIP_EFFECT_GATES === "1" ||
        (await shouldSkipGate(projectRoot, "effect-gates")),
    });
  }

  if (isToolchain) {
    if (pathExists(join(projectRoot, "scripts/install-bin-wrappers.sh"))) {
      planned.push({
        name: "install-wrappers",
        cmd: ["bash", "scripts/install-bin-wrappers.sh"],
        skipped: await shouldSkipWrapperInstall(projectRoot),
      });
    }
    const verify = pathExists(join(projectRoot, "scripts/verify-workspace.sh"))
      ? ["bash", "scripts/verify-workspace.sh"]
      : ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"];
    planned.push({
      name: "workspace-verify",
      cmd: verify,
      skipped: await shouldSkipGate(projectRoot, "workspace-verify"),
    });

    const sync = pathExists(join(projectRoot, "scripts/sync-to-desktop.ts"))
      ? ["bun", "run", "scripts/sync-to-desktop.ts"]
      : ["bun", "run", "sync"];
    const syncSkipped =
      (await shouldSkipGate(projectRoot, "sync")) ||
      ((await detectSyncDrift(projectRoot)).synced && desktopRuntimeDepsOk());
    planned.push({
      name: "sync",
      cmd: sync,
      skipped: syncSkipped,
    });
    planned.push({
      name: "sync:verify",
      cmd: ["bun", "run", "sync:verify"],
      skipped: syncSkipped || (await shouldSkipGate(projectRoot, "sync:verify")),
    });
  }

  return planned;
}

export function emitHookDryRun(
  hook: string,
  policy: PreCommitPolicyAudit | null,
  gates: PlannedGate[]
): void {
  gateOut(`${hook} — dry run`);
  if (policy) {
    gateOut("  policy:");
    for (const message of policy.messages) {
      gateOut(`    ${message}`);
    }
  }
  gateOut("  gates:");
  for (const gate of gates) {
    const skip = gate.skipped ? " (cached — would skip)" : "";
    gateOut(`    → ${gate.cmd.join(" ")}${skip}`);
  }
}

export async function runPreCommitDryRun(projectRoot: string): Promise<number> {
  const policy = await auditPreCommitPolicy(projectRoot);
  const gates = await planPreCommitGates(projectRoot);
  emitHookDryRun("pre-commit", policy, gates);
  return policy.ok ? 0 : 1;
}

export async function runPrePushDryRun(projectRoot: string): Promise<number> {
  const gates = await planPrePushGates(projectRoot);
  emitHookDryRun("pre-push", null, gates);
  return 0;
}
