/**
 * Shared test helpers — Bun-native, isolated, deterministic.
 *
 * Conventions:
 * - Import test symbols from "bun:test".
 * - Use helpers here instead of node:fs / node:os directly.
 * - Clean up temp resources in finally blocks or afterEach.
 * - Prefer async Bun.file/Bun.write over sync fs APIs.
 */

import { join } from "path";
import { tmpdir } from "os";
import { makeDir, pathExists, readText, removePath, writeText } from "../src/lib/bun-io.ts";
import { DECISION_SCHEMA_VERSION, type DecisionRecord } from "../src/lib/decision-ledger.ts";

/** Repository root resolved from this file's location. */
export const REPO_ROOT = join(import.meta.dir, "..");

/** Clear install-audit env overrides that force audit.ok=false in dev/CI shells. */
export const CLEAN_INSTALL_AUDIT_ENV = {
  BUN_CONFIG_SKIP_SAVE_LOCKFILE: undefined,
  BUN_CONFIG_SKIP_LOAD_LOCKFILE: undefined,
  BUN_CONFIG_SKIP_INSTALL_PACKAGES: undefined,
  BUN_INSTALL_CACHE_DIR: undefined,
} as const;

/** Build a complete DecisionRecord fixture with sensible defaults. */
export function decisionRecordFixture(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const decisionId = overrides.decisionId ?? overrides.id ?? "dec-test";
  const rationale = overrides.rationale ?? {
    summary: "test decision",
    fullReasoning: "test decision",
    evidence: [],
  };

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    decisionId,
    id: decisionId,
    key: "config-change",
    timestamp: "2026-06-15T10:00:00.000Z",
    actor: "kimi",
    action: "config-change",
    trigger: { traceId: "trace-test", summary: "test trigger" },
    rationale,
    alternatives: [],
    alternativesConsidered: [],
    outcome: { result: "success" },
    reasoning: rationale.fullReasoning,
    childDecisionIds: [],
    ...overrides,
  };
}

/** Kimi session env keys cleared by default in logger/CLI tests. */
export const SESSION_ENV_KEYS = ["KIMI_AGENT_SESSION", "KIMI_CODE_SESSION"] as const;

/** Create a temp path (directory not created). */
export function testTempPath(prefix = "kimi-test"): string {
  return join(tmpdir(), `${prefix}-${Bun.randomUUIDv7()}`);
}

/** Create a temp directory under the system temp folder. */
export function testTempDir(prefix = "kimi-test"): string {
  const dir = testTempPath(prefix);
  makeDir(dir, { recursive: true });
  return dir;
}

/** Recursively remove a path; ignores missing paths. */
export function cleanupPath(path: string): void {
  removePath(path, { recursive: true, force: true });
}

export interface TempProjectHandle {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a temp project tree and optionally chdir into it for the test body.
 * Restores cwd on cleanup.
 */
export async function createTempProject(
  files: Record<string, string>,
  options?: { chdir?: boolean }
): Promise<TempProjectHandle> {
  const dir = testTempDir("kimi-temp-project-");
  const originalCwd = process.cwd();
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    makeDir(join(dir, ...name.split("/").slice(0, -1)), { recursive: true });
    await Bun.write(path, content);
  }
  if (options?.chdir !== false) process.chdir(dir);
  return {
    dir,
    cleanup: async () => {
      try {
        const cwd = process.cwd();
        if (cwd === dir || cwd.startsWith(`${dir}/`)) process.chdir(originalCwd);
      } catch {
        process.chdir(originalCwd);
      }
      cleanupPath(dir);
    },
  };
}

/**
 * Run a function with a fresh temp directory that is cleaned up afterwards.
 * Supports sync and async callbacks.
 */
export function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => T | Promise<T>
): T | Promise<T> {
  const dir = testTempDir(prefix);
  function cleanup() {
    cleanupPath(dir);
  }
  try {
    const result = fn(dir);
    if (result instanceof Promise) {
      return result.finally(cleanup) as T | Promise<T>;
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Run a function with HOME isolated to KIMI_TEST_HOME or a fresh temp home.
 * Restores the previous HOME afterwards.
 */
export function withIsolatedHome<T>(fn: (home: string) => T | Promise<T>): T | Promise<T> {
  const previous = Bun.env.HOME;
  const home = Bun.env.KIMI_TEST_HOME || testTempDir("kimi-test-home");
  Bun.env.HOME = home;
  makeDir(home, { recursive: true });

  function restore() {
    if (previous === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previous;
  }

  try {
    const result = fn(home);
    if (result instanceof Promise) {
      return result.finally(restore) as T | Promise<T>;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

/**
 * Run a function with overridden environment variables.
 * Restores previous values afterwards.
 */
export function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T | Promise<T>
): T | Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = Bun.env[key];
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }

  function restore() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }

  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(restore) as T | Promise<T>;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

/** Clear named env keys for the duration of a callback (restores prior values). */
export function withClearedEnv<T>(
  keys: readonly string[],
  fn: () => T | Promise<T>
): T | Promise<T> {
  const env: Record<string, undefined> = {};
  for (const key of keys) env[key] = undefined;
  return withEnv(env, fn);
}

/** Isolated HOME + KIMI_TOOLCHAIN_TELEMETRY for cli-runtime telemetry tests. */
export function withTelemetryHome<T>(fn: (home: string) => T | Promise<T>): T | Promise<T> {
  return withIsolatedHome((home) => withEnv({ KIMI_TOOLCHAIN_TELEMETRY: "true" }, () => fn(home)));
}

/** Clear Kimi session env keys (logger agent-context tests). */
export function clearSessionEnv(): void {
  for (const key of SESSION_ENV_KEYS) delete Bun.env[key];
}

export interface CaptureHandle {
  lines: string[];
  restore: () => void;
}

function isStdoutDestination(destination: unknown): boolean {
  return destination === Bun.stdout || destination === 1 || destination === process.stdout;
}

async function stdoutPayloadToText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (data instanceof Response) return data.text();
  if (data instanceof Blob) return data.text();
  return String(data);
}

/**
 * Capture console.log, process.stdout.write, and Bun.write(Bun.stdout, …) during a callback.
 * Use restore() in finally, or captureStdoutAsync for automatic cleanup.
 */
export function captureStdout(): CaptureHandle {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalBunWrite = Bun.write;

  const pushChunk = (chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
  };

  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  process.stdout.write = (chunk: string | Uint8Array) => {
    pushChunk(chunk);
    return true;
  };
  Bun.write = (async (
    destination: Parameters<typeof Bun.write>[0],
    data: Parameters<typeof Bun.write>[1]
  ) => {
    if (isStdoutDestination(destination)) {
      const text = await stdoutPayloadToText(data);
      lines.push(text);
      return text.length;
    }
    return originalBunWrite(destination, data);
  }) as typeof Bun.write;

  return {
    lines,
    restore: () => {
      console.log = originalLog;
      process.stdout.write = originalWrite;
      Bun.write = originalBunWrite;
    },
  };
}

/** Capture console.error and console.warn. */
export function captureStderr(): CaptureHandle {
  const lines: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (msg: string) => lines.push(msg);
  console.warn = (msg: string) => lines.push(msg);
  return {
    lines,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

/** Capture process.stderr.write (CLI contract timeout warnings). */
export function captureStderrWrite(): CaptureHandle {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    const callback = rest.find((r) => typeof r === "function") as (() => void) | undefined;
    if (callback) callback();
    return true;
  };
  return {
    lines,
    restore: () => {
      process.stderr.write = original;
    },
  };
}

/**
 * Capture console.log output during a function.
 * Supports sync and async callbacks.
 */
export async function captureConsole(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await fn();
    return lines;
  } finally {
    console.log = original;
  }
}

/** Capture console.error output during a function. */
export async function captureConsoleError(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await fn();
    return lines;
  } finally {
    console.error = original;
  }
}

/** Read and parse JSON from a file path. */
export async function readJson<T = unknown>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

/** Write pretty-printed JSON to a file path. */
export function writeJson(path: string, data: unknown): void {
  writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Ensure a directory exists. */
export function ensureTestDir(dir: string): void {
  makeDir(dir, { recursive: true });
}

/** Captured subprocess stdout, stderr, and exit code. */
export interface SpawnCaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn a process and capture stdout, stderr, and exit code in parallel.
 * Centralizes Bun.readableStreamToText for test subprocess fixtures.
 */
export async function spawnCaptured(
  cmd: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }
): Promise<SpawnCaptureResult> {
  const proc = Bun.spawn(cmd, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: options?.env ? { ...Bun.env, ...options.env } : undefined,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** Run `bun run <script> [args...]` with stdout/stderr capture. */
export async function runBunScript(
  scriptPath: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }
): Promise<SpawnCaptureResult> {
  return spawnCaptured(["bun", "run", scriptPath, ...args], {
    cwd: options?.cwd ?? REPO_ROOT,
    env: { HOME: Bun.env.HOME || "/tmp", ...options?.env },
  });
}

// Re-export bun-io primitives used directly in tests (no redundant wrappers).
export { makeDir, pathExists, readText, removePath, writeText };
