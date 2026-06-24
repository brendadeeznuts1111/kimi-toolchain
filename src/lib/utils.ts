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
import { isAgentContext, runTool, invokeTool, toolsDir } from "./tool-runner.ts";
import type { HealthReport } from "./health-check.ts";
import { createLogger, logger as defaultLogger } from "./logger.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_SECTION_WIDTH = 60;
const DEFAULT_BANNER_INNER_WIDTH = 62;

// ── File System ──────────────────────────────────────────────────────

/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dir: string) {
  if (!pathExists(dir)) makeDir(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────────────

/** @deprecated Use createLogger() and Logger.info/warn/error instead. */
export function log(level: "info" | "warn" | "error", msg: string) {
  defaultLogger[level](msg);
}

/** @deprecated Use Logger.section() instead. */
export function printSection(title: string, _width = DEFAULT_SECTION_WIDTH): void {
  if (isAgentContext()) return;
  defaultLogger.section(title);
}

/** @deprecated Use Logger.banner() instead. */
export function printToolBanner(
  title: string,
  subtitle?: string,
  _innerWidth = DEFAULT_BANNER_INNER_WIDTH
): void {
  if (isAgentContext()) return;
  defaultLogger.banner(title, subtitle);
}

/** @deprecated Use Logger.projectBanner() instead. */
export function printProjectBanner(title: string, project?: string, subtitle?: string): void {
  if (isAgentContext()) return;
  defaultLogger.projectBanner(title, project, subtitle);
}

// ── Hashing ──────────────────────────────────────────────────────────
// Canonical implementations live in hash.ts to avoid circular imports.
export { sha256File, sha256String } from "./hash.ts";

// ── Safe Parse ────────────────────────────────────────────────────────
// Canonical implementations live in safe-parse.ts to avoid circular imports.
export { safeParse, safeToml, safeJson5, safeJsonc, jsoncSupported } from "./safe-parse.ts";

// ── Project Info ─────────────────────────────────────────────────────

/** Read and parse package.json from a project directory with type-safe fallback. */
export async function readPackageJson<T extends Record<string, unknown>>(
  projectDir: string,
  validator?: (pkg: unknown) => pkg is T
): Promise<T | null> {
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) return null;
  try {
    const pkg: unknown = await Bun.file(pkgPath).json();
    if (validator && !validator(pkg)) return null;
    return pkg as T;
  } catch {
    return null;
  }
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

// ── Executable Resolution ────────────────────────────────────────────

/** Find an executable in PATH. */
export function findExecutable(bin: string): string | null {
  return Bun.which(bin);
}

// ── Stream Helpers ───────────────────────────────────────────────────

/** Convert a ReadableStream to a text string. */
export { readableStreamToText as streamToText } from "./bun-utils.ts";

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

// ── Doctor/Fix Integration Helpers ───────────────────────────────────

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

/** @deprecated Use Logger.printHealthReport() with createLogger() instead. */
export function printDoctorReport(report: HealthReport) {
  createLogger(Bun.argv, report.tool).printHealthReport(report);
}

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
