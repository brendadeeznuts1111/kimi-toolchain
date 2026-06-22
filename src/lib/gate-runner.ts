/**
 * Shared quality-gate runner — silent on success, verbose on failure, optional cache.
 */

import { readableStreamToText } from "./bun-utils.ts";
import { makeDir, pathExists } from "./bun-io.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";
import { GIT_LOCAL_ENV_KEYS, withBunNoOrphans } from "./tool-runner.ts";
import { formatErrorColored } from "./error-format.ts";

import { join } from "path";
import { $ } from "bun";
import { isHookSummaryMode, parseBunTestSummary } from "./quiet-mode.ts";
import { safeParse } from "./utils.ts";

export interface GateCacheFile {
  commit: string;
  gates: string[];
  timestamp: number;
}

export interface GateResult {
  name: string;
  exitCode: number;
  ms: number;
  stdout: string;
  stderr: string;
  skipped?: boolean;
}

export function gateCachePath(projectRoot: string): string {
  return join(projectRoot, ".kimi", ".last-good-commit");
}

const GIT_LOCAL_ENV_KEY_SET = new Set<string>(GIT_LOCAL_ENV_KEYS);

function scrubbedGitEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !GIT_LOCAL_ENV_KEY_SET.has(entry[0])
    )
  );
}

function ensureValidCwd(fallbackDir: string): void {
  try {
    process.cwd();
  } catch {
    // If the current working directory was deleted by a test, reset to a safe path
    // so subsequent spawns (including git) do not fail with ENOENT getcwd.
    process.chdir(fallbackDir);
  }
}

export async function currentGitHead(projectRoot: string): Promise<string | null> {
  ensureValidCwd(projectRoot);
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: projectRoot,
    env: scrubbedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;
  const head = (await readableStreamToText(proc.stdout)).trim();
  return head || null;
}

export async function readGateCache(projectRoot: string): Promise<GateCacheFile | null> {
  const path = gateCachePath(projectRoot);
  if (!pathExists(path)) return null;
  const parsed = safeParse<GateCacheFile | null>(await Bun.file(path).text(), null);
  if (!parsed?.commit || !Array.isArray(parsed.gates)) return null;
  return parsed;
}

export async function writeGateCache(projectRoot: string, gates: string[]): Promise<void> {
  const head = await currentGitHead(projectRoot);
  if (!head) return;
  const path = gateCachePath(projectRoot);
  makeDir(join(projectRoot, ".kimi"), { recursive: true });
  const payload: GateCacheFile = {
    commit: head,
    gates,
    timestamp: Date.now(),
  };
  await Bun.write(path, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Merge newly passed gates into the cache for the current commit. */
export async function appendGateCache(projectRoot: string, gates: string[]): Promise<void> {
  if (gates.length === 0) return;
  const head = await currentGitHead(projectRoot);
  if (!head) return;
  const existing = await readGateCache(projectRoot);
  const merged =
    existing?.commit === head ? [...new Set([...existing.gates, ...gates])] : [...new Set(gates)];
  await writeGateCache(projectRoot, merged);
}

export async function shouldSkipGate(projectRoot: string, gate: string): Promise<boolean> {
  const head = await currentGitHead(projectRoot);
  if (!head) return false;
  const cache = await readGateCache(projectRoot);
  return cache?.commit === head && cache.gates.includes(gate);
}

function gateSpawnEnv(env?: Record<string, string | undefined>): Record<string, string> {
  return withNoOrphansEnv({ ...Bun.env, ...env });
}

export async function runGate(
  name: string,
  cmd: string[],
  options: { cwd: string; env?: Record<string, string | undefined> }
): Promise<GateResult> {
  const start = Bun.nanoseconds();
  const proc = Bun.spawn(withBunNoOrphans(cmd), {
    cwd: options.cwd,
    env: gateSpawnEnv(options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);

  const budget = fastGateTimeoutBudgetMs();
  if (budget > 0 && ms > budget && exitCode === 0) {
    const budgetMsg = `TIMEOUT: ${name} took ${ms}ms, budget is ${budget}ms — set KIMI_CHECK_FAST_TIMEOUT_MS higher or optimize the step`;
    return {
      name,
      exitCode: 1,
      ms,
      stdout,
      stderr: [stderr, budgetMsg].filter(Boolean).join("\n"),
    };
  }

  return { name, exitCode, ms, stdout, stderr };
}

/** Read KIMI_CHECK_FAST_TIMEOUT_MS budget. Returns 0 (no limit) when unset. */
export function fastGateTimeoutBudgetMs(): number {
  const raw = Bun.env.KIMI_CHECK_FAST_TIMEOUT_MS;
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function noColorEnabled(): boolean {
  return Bun.env.NO_COLOR !== undefined && Bun.env.NO_COLOR !== "0" && Bun.env.NO_COLOR !== "false";
}

export function failMark(): string {
  return noColorEnabled() ? "FAIL" : "✗";
}

export function okMark(): string {
  return noColorEnabled() ? "OK" : "✓";
}

export async function porcelainDirtyLines(projectRoot: string): Promise<string[]> {
  const result = await $`git status --porcelain=v1`.cwd(projectRoot).nothrow().quiet();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

const GATE_TAXONOMY_BY_NAME: Partial<Record<string, string>> = {
  "format:check": "format_check_failure",
  lint: "lint_failure",
  typecheck: "typecheck_failure",
  "effect-gates": "effect_gates_failure",
  "constant-drift": "constants_drift",
  "r-score": "lockfile_issue",
};

function gateFailureHeader(result: GateResult, message: string): string {
  const taxonomyId = GATE_TAXONOMY_BY_NAME[result.name];
  if (noColorEnabled()) {
    return `${failMark()} ${result.name}: ${message}`;
  }
  return formatErrorColored({
    domain: "gates",
    code: result.name.replace(/[:.]/g, "_"),
    message,
    severity: "error",
    ...(taxonomyId ? { taxonomyId } : {}),
  });
}

export function emitGateFailure(result: GateResult): void {
  Bun.stderr.write(`${gateFailureHeader(result, `exited with code ${result.exitCode}`)}\n`);
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (detail) Bun.stderr.write(`${detail}\n`);
}

/** One-line stderr hint for hook summary mode (first non-empty output line). */
export function emitGateFailureBrief(result: GateResult): void {
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  const firstLine = detail
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  Bun.stderr.write(
    `${gateFailureHeader(result, firstLine ?? `exited with code ${result.exitCode}`)}\n`
  );
}

export function formatHookSummary(hook: string, results: GateResult[]): string {
  const totalMs = results.reduce((sum, item) => sum + item.ms, 0);
  const parts = results.map((item) => {
    if (item.skipped) return `↷${shortGateName(item.name)}`;
    return item.exitCode === 0
      ? `${okMark()}${shortGateName(item.name)}`
      : `${failMark()}${shortGateName(item.name)}`;
  });
  return `[${hook}] ${parts.join(" ")} (${totalMs}ms)`;
}

function shortGateName(name: string): string {
  const map: Record<string, string> = {
    "format:check": "fmt",
    lint: "lint",
    typecheck: "tsc",
    "test:fast": "test",
    test: "test",
    "tuning-set": "tuning",
    guardian: "guard",
    "r-score": "rscore",
    check: "check",
    "check:fast": "check",
    "workspace-verify": "ws",
    "constant-drift": "const",
    sync: "sync",
    "sync:verify": "sync-v",
  };
  return map[name] ?? name;
}

export function emitHookSummary(hook: string, results: GateResult[]): void {
  Bun.stdout.write(`${formatHookSummary(hook, results)}\n`);
}

export async function runGateOrSkip(
  projectRoot: string,
  name: string,
  cmd: string[],
  options: { cacheable?: boolean; env?: Record<string, string | undefined> } = {}
): Promise<GateResult> {
  if (options.cacheable && (await shouldSkipGate(projectRoot, name))) {
    return { name, exitCode: 0, ms: 0, stdout: "", stderr: "", skipped: true };
  }
  return runGate(name, cmd, { cwd: projectRoot, env: options.env });
}

export function shouldSilentOnSuccess(): boolean {
  // Default to silent-on-success for gates; opt out with KIMI_VERBOSE=1 or KIMI_QUIET=0.
  if (Bun.env.KIMI_VERBOSE === "1") return false;
  if (Bun.env.KIMI_QUIET === "0") return false;
  return true;
}

/** Run gate: inherit stdout when verbose; pipe + dump on failure when quiet. */
export async function runCheckStep(name: string, cmd: string[], cwd: string): Promise<number> {
  const quiet = shouldSilentOnSuccess();
  if (!quiet) {
    const proc = Bun.spawn(withBunNoOrphans(cmd), {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      env: gateSpawnEnv(),
    });
    return await proc.exited;
  }

  const result = await runGate(name, cmd, { cwd });
  if (result.exitCode !== 0) {
    emitGateFailure(result);
    return result.exitCode;
  }
  return 0;
}

export function formatTestSummaryLine(output: string): string | null {
  const summary = parseBunTestSummary(output);
  if (!summary) return null;
  const sec = summary.ms > 0 ? ` [${(summary.ms / 1000).toFixed(1)}s]` : "";
  return `✓ tests (${summary.pass} passed, ${summary.fail} failed${summary.files ? `, ${summary.files} files` : ""})${sec}`;
}

export function hookUsesSummary(): boolean {
  return isHookSummaryMode();
}
