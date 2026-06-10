#!/usr/bin/env bun
/**
 * kimi-utils — Shared utilities for all kimi tools
 * Bun-native only. Zero dependencies.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

// ── File System ──────────────────────────────────────────────────────

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────────────

export function log(level: "info" | "warn" | "error", msg: string) {
  const prefix = { info: "  ✓", warn: "  ⚠", error: "  ✗" }[level];
  console.log(`${prefix} ${msg}`);
}

export function printSection(title: string, width = 60): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, width - title.length))}`);
}

export function printToolBanner(title: string, innerWidth = 62): void {
  const pad = Math.max(0, innerWidth - title.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const bar = "═".repeat(innerWidth + 2);
  console.log(`╔${bar}╗`);
  console.log(`║ ${" ".repeat(left)}${title}${" ".repeat(right)} ║`);
  console.log(`╚${bar}╝`);
}

// ── Hashing ──────────────────────────────────────────────────────────

export async function sha256File(path: string): Promise<string> {
  const file = Bun.file(path);
  const content = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(content);
  return hash.digest("hex");
}

export function sha256String(data: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(data);
  return hash.digest("hex");
}

// ── Safe JSON ────────────────────────────────────────────────────────

export function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ── Project Info ─────────────────────────────────────────────────────

export function getProjectName(projectDir: string = Bun.cwd): string {
  const root = projectDir.replace(/\/$/, "");
  if (!root) return "unknown";
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
    } catch {
      /* fall through to directory name */
    }
  }
  const base = root.split("/").pop();
  return base || "unknown";
}

// ── Project Root ─────────────────────────────────────────────────────

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

export function findExecutable(bin: string): string | null {
  return Bun.which(bin);
}

// ── Stream Helpers ───────────────────────────────────────────────────

export async function streamToText(stream: ReadableStream): Promise<string> {
  return Bun.readableStreamToText(stream);
}

// ── Fetch with Timeout ───────────────────────────────────────────────

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

export function toolsDir(): string {
  return join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");
}

export async function runTool(
  toolName: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const toolPath = join(toolsDir(), `${toolName}.ts`);
  if (!existsSync(toolPath)) {
    throw new Error(`Tool not found: ${toolPath}`);
  }
  const proc = Bun.spawn(["bun", "run", toolPath, ...args], {
    cwd: options?.cwd || Bun.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = options?.timeoutMs || 60000;
  const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await streamToText(proc.stdout);
  const stderr = await streamToText(proc.stderr);
  return { stdout, stderr, exitCode };
}

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
