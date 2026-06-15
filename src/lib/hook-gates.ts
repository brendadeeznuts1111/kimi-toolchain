/**
 * Pre-commit / pre-push gate orchestration for kimi-githooks run-gates.
 */

import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import {
  emitGateFailure,
  emitHookSummary,
  formatTestSummaryLine,
  hookUsesSummary,
  runGate,
  shouldSkipGate,
  writeGateCache,
  type GateResult,
} from "./gate-runner.ts";
import { isQuietMode } from "./quiet-mode.ts";
import { isKimiToolchainRepo } from "./workspace-health.ts";
import { readPackageJson } from "./utils.ts";
import { buildConstantRepairPlan } from "./constants-heal.ts";

const PRE_COMMIT_CACHE_GATES = ["format:check", "lint", "typecheck", "test:fast"] as const;

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

async function runScriptGate(
  projectRoot: string,
  name: string,
  script: string,
  options: { cacheable?: boolean } = {}
): Promise<GateResult> {
  if (options.cacheable && (await shouldSkipGate(projectRoot, name))) {
    return { name, exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  return runGateVisible(projectRoot, name, ["bun", "run", script]);
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

export async function runPreCommitGates(projectRoot: string): Promise<number> {
  const summary = hookUsesSummary();
  const results: GateResult[] = [];

  const gates: Array<() => Promise<GateResult | null>> = [
    async () => {
      if (!(await packageHasScript(projectRoot, "format:check"))) return null;
      if (!summary) printVerboseBanner("Format check");
      return runScriptGate(projectRoot, "format:check", "format:check", { cacheable: true });
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "lint"))) return null;
      if (!summary) printVerboseBanner("Lint");
      return runScriptGate(projectRoot, "lint", "lint", { cacheable: true });
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "typecheck"))) return null;
      if (!summary) printVerboseBanner("Type check");
      return runScriptGate(projectRoot, "typecheck", "typecheck", { cacheable: true });
    },
    async () => {
      if (!(await packageHasScript(projectRoot, "test:fast"))) return null;
      if (!summary) printVerboseBanner("Unit tests (fast)");
      return runScriptGate(projectRoot, "test:fast", "test:fast", { cacheable: true });
    },
    async () => {
      const tuning = join(projectRoot, "scripts/lint-tuning-set-version.ts");
      if (!existsSync(tuning)) return null;
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

  const passed = results.filter((item) => !item.skipped).map((item) => item.name);
  const cacheable = PRE_COMMIT_CACHE_GATES.filter((gate) => passed.includes(gate));
  if (cacheable.length > 0) await writeGateCache(projectRoot, [...cacheable]);

  if (summary) emitHookSummary("pre-commit", results);
  return 0;
}

async function runGuardianGate(projectRoot: string): Promise<GateResult> {
  const guardian = existsSync(join(projectRoot, "src/bin/kimi-guardian.ts"))
    ? join(projectRoot, "src/bin/kimi-guardian.ts")
    : null;
  if (!guardian) {
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

async function runRScoreGate(projectRoot: string): Promise<GateResult> {
  const governance = existsSync(join(projectRoot, "src/bin/kimi-governance.ts"))
    ? join(projectRoot, "src/bin/kimi-governance.ts")
    : null;
  if (!governance) {
    return { name: "r-score", exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  const result = await runGateVisible(projectRoot, "r-score", ["bun", "run", governance, "score"]);
  const gradeLine = [result.stdout, result.stderr].join("\n").match(/Grade:\s*([A-F])/);
  const grade = gradeLine?.[1];
  if (grade === "F" || grade === "D") {
    return {
      ...result,
      exitCode: 1,
      stderr: `PUSH BLOCKED: R-Score is ${grade}. Run: bun run ${governance} fix`,
    };
  }
  return result;
}

async function qualityGatesCached(projectRoot: string): Promise<boolean> {
  for (const gate of PRE_COMMIT_CACHE_GATES) {
    if (!(await shouldSkipGate(projectRoot, gate))) return false;
  }
  return true;
}

export async function runPrePushGates(projectRoot: string): Promise<number> {
  const summary = hookUsesSummary();
  const results: GateResult[] = [];
  const isToolchain = await isKimiToolchainRepo(projectRoot);

  if (!summary) gateOut("═══ Kimi Pre-Push Gate ═══");

  const steps: Array<() => Promise<GateResult>> = [
    async () => {
      if (!summary) printVerboseBanner("Supply Chain Security");
      return runGuardianGate(projectRoot);
    },
    async () => {
      if (!summary) printVerboseBanner("Constant Drift Gate");
      return runConstantDriftGate(projectRoot);
    },
    async () => {
      if (!summary) printVerboseBanner("R-Score Gate");
      return runRScoreGate(projectRoot);
    },
    async () => {
      if (!summary) printVerboseBanner("Quality Gate");
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
    },
  ];

  if (isToolchain) {
    steps.push(async () => {
      if (!summary) printVerboseBanner("PATH Wrapper Refresh");
      const installer = join(projectRoot, "scripts/install-bin-wrappers.sh");
      if (!existsSync(installer)) {
        return {
          name: "install-wrappers",
          exitCode: 0,
          ms: 0,
          stdout: "",
          stderr: "",
          skipped: true,
        };
      }
      return runGateVisible(projectRoot, "install-wrappers", [
        "bash",
        "scripts/install-bin-wrappers.sh",
      ]);
    });
    steps.push(async () => {
      if (!summary) printVerboseBanner("Workspace Verify");
      const verify = existsSync(join(projectRoot, "scripts/verify-workspace.sh"))
        ? ["bash", "scripts/verify-workspace.sh"]
        : ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"];
      return runGateVisible(projectRoot, "workspace-verify", verify);
    });
    steps.push(async () => {
      if (!summary) printVerboseBanner("Desktop Sync (mandatory)");
      const sync = existsSync(join(projectRoot, "scripts/sync-to-desktop.ts"))
        ? ["bun", "run", "scripts/sync-to-desktop.ts"]
        : ["bun", "run", "sync"];
      return runGateVisible(projectRoot, "sync", sync);
    });
    steps.push(async () => {
      if (!summary) printVerboseBanner("Sync Manifest Verify");
      return runGateVisible(projectRoot, "sync:verify", ["bun", "run", "sync:verify"]);
    });
  }

  for (const run of steps) {
    const result = await run();
    results.push(result);
    if (result.exitCode !== 0) {
      if (summary) emitHookSummary("pre-push", results);
      else emitGateFailure(result);
      return result.exitCode;
    }
    if (!summary && !result.skipped) {
      const testLine = formatTestSummaryLine(result.stdout);
      if (testLine) gateOut(`  ${testLine}`);
    }
  }

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
  if (existsSync(join(projectRoot, "scripts/lint-tuning-set-version.ts"))) {
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

  if (existsSync(join(projectRoot, "src/bin/kimi-guardian.ts"))) {
    planned.push({
      name: "guardian",
      cmd: ["bun", "run", "src/bin/kimi-guardian.ts", "check"],
      skipped: false,
    });
  }
  if (await isKimiToolchainRepo(projectRoot)) {
    planned.push({
      name: "constant-drift",
      cmd: ["hook-gates", "runConstantDriftGate"],
      skipped: Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE === "1",
    });
  }
  if (existsSync(join(projectRoot, "src/bin/kimi-governance.ts"))) {
    planned.push({
      name: "r-score",
      cmd: ["bun", "run", "src/bin/kimi-governance.ts", "score"],
      skipped: false,
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

  if (isToolchain) {
    const verify = existsSync(join(projectRoot, "scripts/verify-workspace.sh"))
      ? ["bash", "scripts/verify-workspace.sh"]
      : ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"];
    planned.push({ name: "workspace-verify", cmd: verify, skipped: false });

    const sync = existsSync(join(projectRoot, "scripts/sync-to-desktop.ts"))
      ? ["bun", "run", "scripts/sync-to-desktop.ts"]
      : ["bun", "run", "sync"];
    planned.push({ name: "sync", cmd: sync, skipped: false });
    planned.push({
      name: "sync:verify",
      cmd: ["bun", "run", "sync:verify"],
      skipped: false,
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
