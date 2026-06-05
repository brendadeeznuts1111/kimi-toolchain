#!/usr/bin/env bun
/**
 * kimi-utils — Shared utilities for all kimi tools
 * Bun-native only. Zero dependencies.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// ── File System ──────────────────────────────────────────────────────

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Logging ──────────────────────────────────────────────────────────

export function log(level: "info" | "warn" | "error", msg: string) {
  const prefix = { info: "  ✓", warn: "  ⚠", error: "  ✗" }[level];
  console.log(`${prefix} ${msg}`);
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
  return projectDir.split("/").pop() || "unknown";
}

// ── Executable Resolution ────────────────────────────────────────────

export function findExecutable(bin: string): string | null {
  return Bun.which(bin);
}

// ── Stream Helpers ───────────────────────────────────────────────────

export async function streamToText(stream: ReadableStream): Promise<string> {
  return Bun.readableStreamToText(stream);
}

export async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  return Bun.readableStreamToBytes(stream);
}

// ── Fetch with Timeout ───────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...fetchOptions, signal: ctrl.signal });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Process Output ───────────────────────────────────────────────────

export async function readProcessOutput(proc: {
  stdout: ReadableStream;
  stderr: ReadableStream;
}): Promise<{ stdout: string; stderr: string }> {
  const [stdout, stderr] = await Promise.all([
    streamToText(proc.stdout),
    streamToText(proc.stderr),
  ]);
  return { stdout, stderr };
}

// ── Tool Runner (for cross-tool integration) ─────────────────────────

const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");

export async function runTool(
  toolName: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const toolPath = join(TOOLS_DIR, `${toolName}.ts`);
  if (!existsSync(toolPath)) {
    throw new Error(`Tool not found: ${toolPath}`);
  }
  const proc = Bun.spawn(["bun", "run", toolPath, ...args], {
    cwd: options?.cwd || Bun.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = options?.timeoutMs || 60000;
  const timeout = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);

  const exitCode = await proc.exited;
  clearTimeout(timeout);

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
  console.log(`── ${report.tool} Doctor ─────────────────────────────────────────`);
  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    const fixTag = check.fixable ? " [fixable]" : "";
    console.log(`  ${icon} ${check.name}: ${check.message}${fixTag}`);
  }
  console.log(`  ${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`);
}
