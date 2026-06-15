#!/usr/bin/env bun
/**
 * kimi-utils — Shared utilities for all kimi tools
 * Bun-native only. Zero dependencies.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import {
  runTool,
  invokeTool,
  toolsDir,
  isAgentContext,
  type ToolInvocation,
  type ToolInvocationOptions,
} from "./tool-runner.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_SECTION_WIDTH = 60;
const DEFAULT_BANNER_INNER_WIDTH = 62;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Return the icon character for a doctor/workspace check status. */
export function statusIcon(status: "ok" | "warn" | "error"): string {
  return status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
}

// ── File System ──────────────────────────────────────────────────────

/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────────────

import type { HealthReport } from "./health-check.ts";
import { createLogger, logger as defaultLogger } from "./logger.ts";

/** @deprecated Use createLogger() and Logger.info/warn/error instead */
export function log(level: "info" | "warn" | "error", msg: string) {
  defaultLogger[level](msg);
}

/** @deprecated Use Logger.section() instead */
export function printSection(title: string, _width = DEFAULT_SECTION_WIDTH): void {
  if (isAgentContext()) return;
  defaultLogger.section(title);
}

/** @deprecated Use Logger.banner() instead */
export function printToolBanner(
  title: string,
  subtitle?: string,
  _innerWidth = DEFAULT_BANNER_INNER_WIDTH
): void {
  if (isAgentContext()) return;
  defaultLogger.banner(title, subtitle);
}

/** @deprecated Use Logger.banner() and Logger.info() instead */
export function printProjectBanner(title: string, project?: string, subtitle?: string): void {
  if (isAgentContext()) return;
  defaultLogger.banner(title, subtitle);
  if (project) defaultLogger.info(`Project: ${project}`);
  defaultLogger.line("");
}

// ── Hashing ──────────────────────────────────────────────────────────

/** Compute the SHA-256 hex digest of a file. */
export async function sha256File(path: string): Promise<string> {
  const file = Bun.file(path);
  const content = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/** Compute the SHA-256 hex digest of a string. */
export function sha256String(data: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(data);
  return hash.digest("hex");
}

// ── Safe Parse (shared implementation) ─────────────────────────────────

function _safeParse<T>(
  parse: (input: string) => unknown,
  input: string,
  fallback: T,
  validator?: (v: unknown) => v is T
): T {
  try {
    const parsed: unknown = parse(input);
    if (validator) {
      return validator(parsed) ? parsed : fallback;
    }
    // Blind cast when no validator — caller assumes responsibility
    return parsed as T;
  } catch {
    return fallback;
  }
}

// ── Safe JSON ────────────────────────────────────────────────────────

/** Safely parse JSON with a fallback value on failure. */
export function safeParse<T>(json: string, fallback: T): T;
/** Safely parse JSON with a fallback and optional validator. */
export function safeParse<T>(json: string, fallback: T, validator: (v: unknown) => v is T): T;
export function safeParse<T>(json: string, fallback: T, validator?: (v: unknown) => v is T): T {
  return _safeParse(JSON.parse, json, fallback, validator);
}

// ── Project Info ─────────────────────────────────────────────────────

/** Read and parse package.json from a project directory with type-safe fallback. */
export async function readPackageJson<T extends Record<string, unknown>>(
  projectDir: string,
  validator?: (pkg: unknown) => pkg is T
): Promise<T | null> {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return null;
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
export async function streamToText(stream: ReadableStream): Promise<string> {
  return Bun.readableStreamToText(stream);
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

// Re-export unified tool runner, helpers, and types.
export { runTool, invokeTool, toolsDir, ToolInvocation, ToolInvocationOptions };

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

/** @deprecated Use Logger.check() with createLogger() instead */
export function printDoctorReport(report: HealthReport) {
  const logger = createLogger(Bun.argv, report.tool);
  logger.section(`${report.tool} Doctor`);
  for (const check of report.checks) {
    logger.check(check);
  }
  logger.info(
    `${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`
  );
}

// ── Safe TOML ────────────────────────────────────────────────────────

export function safeToml<T>(text: string, fallback: T): T;
/** Safely parse TOML with a fallback and optional validator. */
export function safeToml<T>(text: string, fallback: T, validate: (val: unknown) => val is T): T;
export function safeToml<T>(text: string, fallback: T, validate?: (val: unknown) => val is T): T {
  return _safeParse(Bun.TOML.parse, text, fallback, validate);
}

// Re-export doctor persistence (canonical impl in doctor-runs.ts)
export { recordDoctorRun, getPersistentWarnings, type DoctorWarning } from "./doctor-runs.ts";
