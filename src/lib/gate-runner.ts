/**
 * Shared quality-gate runner — silent on success, verbose on failure, optional cache.
 */

import { readableStreamToText } from "./bun-utils.ts";
import { makeDir, pathExists } from "./bun-io.ts";

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

export async function currentGitHead(projectRoot: string): Promise<string | null> {
  const result = await $`git rev-parse HEAD`.cwd(projectRoot).nothrow().quiet();
  if (result.exitCode !== 0) return null;
  const head = result.stdout.toString().trim();
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

export async function runGate(
  name: string,
  cmd: string[],
  options: { cwd: string; env?: Record<string, string | undefined> }
): Promise<GateResult> {
  const start = Bun.nanoseconds();
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    env: { ...Bun.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return {
    name,
    exitCode,
    ms: Math.round((Bun.nanoseconds() - start) / 1_000_000),
    stdout,
    stderr,
  };
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

export function emitGateFailure(result: GateResult): void {
  Bun.stderr.write(`${failMark()} ${result.name}\n`);
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
  if (firstLine) {
    Bun.stderr.write(`${failMark()} ${result.name}: ${firstLine}\n`);
    return;
  }
  Bun.stderr.write(`${failMark()} ${result.name}\n`);
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
    const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
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
