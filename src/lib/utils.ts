#!/usr/bin/env bun
/**
 * kimi-utils — Shared utilities for all kimi tools
 * Bun-native only. Zero dependencies.
 *
 * For logging: import { createLogger } from "./logger.ts"
 * For tool running: import { runTool, invokeTool } from "./tool-runner.ts"
 * For health checks: import { aggregateChecks, type HealthCheck } from "./health-check.ts"
 * For paths: import { toolsDir, homeDir } from "./paths.ts"
 */

import { makeDir, pathExists } from "./bun-io.ts";
import { join } from "path";
import { $ } from "bun";
import { runTool, invokeTool, toolsDir } from "./tool-runner.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

// ── File System ──────────────────────────────────────────────────────

/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dir: string) {
  if (!pathExists(dir)) makeDir(dir, { recursive: true });
}

// ── Hashing ──────────────────────────────────────────────────────────
// Canonical implementations live in hash.ts to avoid circular imports.
export { sha256File, sha256String } from "./hash.ts";

// ── Safe Parse ────────────────────────────────────────────────────────
// Canonical implementations live in safe-parse.ts to avoid circular imports.
export { safeParse, safeToml, safeJson5, safeJsonc, jsoncSupported } from "./safe-parse.ts";

// ── Project Info ─────────────────────────────────────────────────────

/** Minimal package.json shape for governance, release, and context scans. */
export interface PackageJsonManifest {
  [key: string]: unknown;
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  packageManager?: string;
  bin?: Record<string, string>;
  trustedDependencies?: unknown[];
}

export function isPackageJsonManifest(value: unknown): value is PackageJsonManifest {
  return typeof value === "object" && value !== null;
}

/** Read and parse package.json from a project directory with type-safe fallback. */
export async function readPackageJson<T extends Record<string, unknown>>(
  projectDir: string,
  validator?: (pkg: unknown) => pkg is T
): Promise<T | null> {
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) return null;
  const pkg = await Bun.file(pkgPath).json();
  if (validator) return validator(pkg) ? pkg : null;
  return isPackageJsonManifest(pkg) ? (pkg as T) : null;
}

/** Typed package.json read for common kimi-toolchain scans. */
export async function readPackageManifest(projectDir: string): Promise<PackageJsonManifest | null> {
  return readPackageJson(projectDir, isPackageJsonManifest);
}

/** Get the project name from package.json, falling back to the directory name. */
export async function getProjectName(projectDir: string = Bun.cwd): Promise<string> {
  const root = projectDir.replace(/\/$/, "");
  if (!root) return "unknown";
  const pkg = await readPackageJson(
    root,
    (p): p is { name?: string } => typeof p === "object" && p !== null && "name" in p
  );
  if (pkg?.name && typeof pkg.name === "string" && pkg.name.trim()) {
    return pkg.name.trim();
  }
  const base = root.split("/").pop();
  return base || "unknown";
}

// ── Project Root ─────────────────────────────────────────────────────

/** Resolve the project root via git, falling back to the provided path. */
export async function resolveProjectRoot(fallback: string = Bun.cwd): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
    const root = result.stdout?.toString().trim();
    return root || fallback;
  } catch {
    return fallback;
  }
}

// ── Fetch with Timeout ───────────────────────────────────────────────

/** Fetch a URL with a configurable timeout (default 10s). */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<globalThis.Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOptions } = options;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Tool Runner (for cross-tool integration) ─────────────────────────

export { runTool, invokeTool, toolsDir };

export {
  type HealthCheck,
  type HealthReport,
  type DoctorCheck,
  type DoctorReport,
  type CheckStatus,
  aggregateChecks,
  buildDoctorReport,
  statusIcon as healthStatusIcon,
} from "./health-check.ts";

// Re-export doctor persistence (canonical impl in doctor-runs.ts)
export {
  recordDoctorRun,
  getPersistentWarnings,
  getDoctorRunsByRunId,
  getDoctorRunsBySession,
  getDoctorRunsByProject,
  type DoctorWarning,
  type DoctorRunRecord,
} from "./doctor-runs.ts";
