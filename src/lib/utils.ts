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
  type ToolInvocation,
  type ToolInvocationOptions,
} from "./tool-runner.ts";

// ── File System ──────────────────────────────────────────────────────

/** Ensure a directory exists, creating it recursively if needed. */
export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────────────

/** Log a message with a level-appropriate prefix. */
export function log(level: "info" | "warn" | "error", msg: string) {
  const prefix = { info: "  ✓", warn: "  ⚠", error: "  ✗" }[level];
  console.log(`${prefix} ${msg}`);
}

/** Print a section header with decorative borders. */
export function printSection(title: string, width = 60): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, width - title.length))}`);
}

/** Print a centered tool banner with optional subtitle. */
export function printToolBanner(title: string, subtitle?: string, innerWidth = 62): void {
  const pad = Math.max(0, innerWidth - title.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const bar = "═".repeat(innerWidth + 2);
  console.log(`╔${bar}╗`);
  console.log(`║ ${" ".repeat(left)}${title}${" ".repeat(right)} ║`);
  if (subtitle) {
    const subPad = Math.max(0, innerWidth - subtitle.length);
    const subLeft = Math.floor(subPad / 2);
    const subRight = subPad - subLeft;
    console.log(`║ ${" ".repeat(subLeft)}${subtitle}${" ".repeat(subRight)} ║`);
  }
  console.log(`╚${bar}╝`);
}

/** Print a project banner with optional project name and subtitle. */
export function printProjectBanner(title: string, project?: string, subtitle?: string): void {
  printToolBanner(title, subtitle);
  if (project) console.log(`  Project: ${project}`);
  console.log("");
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

// ── Safe JSON ────────────────────────────────────────────────────────

/** Safely parse JSON with a fallback value on failure. */
export function safeParse<T>(json: string, fallback: T): T;
/** Safely parse JSON with a fallback and optional validator. */
export function safeParse<T>(json: string, fallback: T, validator: (v: unknown) => v is T): T;
export function safeParse<T>(json: string, fallback: T, validator?: (v: unknown) => v is T): T {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (validator) {
      return validator(parsed) ? parsed : fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
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
    const pkg = (await Bun.file(pkgPath).json()) as unknown;
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
  const { timeoutMs = 10000, ...fetchOptions } = options;
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

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface DoctorReport {
  tool: string;
  checks: DoctorCheck[];
  fixableCount: number;
  errorCount: number;
  warnCount: number;
}

export function printDoctorReport(report: DoctorReport) {
  printSection(`${report.tool} Doctor`);
  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    const fixTag = check.fixable ? " [fixable]" : "";
    console.log(`  ${icon} ${check.name}: ${check.message}${fixTag}`);
  }
  console.log(
    `  ${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`
  );
}

export function buildDoctorReport(tool: string, checks: DoctorCheck[]): DoctorReport {
  return {
    tool,
    checks,
    errorCount: checks.filter((c) => c.status === "error").length,
    warnCount: checks.filter((c) => c.status === "warn").length,
    fixableCount: checks.filter((c) => c.fixable).length,
  };
}

// Re-export doctor persistence (canonical impl in doctor-runs.ts)
export { recordDoctorRun, getPersistentWarnings, type DoctorWarning } from "./doctor-runs.ts";
