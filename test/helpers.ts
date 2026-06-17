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

/** Repository root resolved from this file's location. */
export const REPO_ROOT = join(import.meta.dir, "..");

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

/**
 * Capture console.log and process.stdout.write during a callback.
 * Use restore() in finally, or captureStdoutAsync for automatic cleanup.
 */
export function captureStdout(): CaptureHandle {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  return {
    lines,
    restore: () => {
      console.log = originalLog;
      process.stdout.write = originalWrite;
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

// Re-export bun-io primitives used directly in tests (no redundant wrappers).
export { pathExists, readText, writeText };
