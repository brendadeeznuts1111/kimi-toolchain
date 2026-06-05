#!/usr/bin/env bun
/**
 * kimi-utils — Shared utilities for all kimi tools
 * Bun-native only. Zero dependencies.
 */

import { existsSync, mkdirSync } from "fs";
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

// ── Process Guard (prevents runaway spawning) ─────────────────────────

const GUARD_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "guard");
const GUARD_PID_FILE = join(GUARD_DIR, "test-runner.pid");
const MAX_CONCURRENT_TEST_PROCS = 16; // hard ceiling on test-related bun processes

/** Check if another test runner is already active */
export function isTestRunnerActive(): boolean {
  try {
    if (!existsSync(GUARD_PID_FILE)) return false;
    const pid = parseInt(Bun.file(GUARD_PID_FILE).textSync(), 10);
    if (isNaN(pid)) return false;
    // Check if process still exists (signal 0 is no-op check)
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** Register this process as the active test runner */
export function registerTestRunner(): void {
  ensureDir(GUARD_DIR);
  Bun.write(GUARD_PID_FILE, String(process.pid));
}

/** Unregister this process as the active test runner */
export function unregisterTestRunner(): void {
  try {
    if (existsSync(GUARD_PID_FILE)) {
      const pid = parseInt(Bun.file(GUARD_PID_FILE).textSync(), 10);
      if (pid === process.pid) {
        if (Bun.file(GUARD_PID_FILE).delete) {
          Bun.file(GUARD_PID_FILE).delete();
        } else {
          require("fs").unlinkSync(GUARD_PID_FILE);
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** Count test-related bun processes (bun test, bun run *kimi, kimi --version) */
export function countTestProcesses(): number {
  try {
    const result = require("child_process")?.execSync?.(
      'ps aux | grep -E "bun test|bun run.*kimi-|kimi --version|/bin/cp.*kimi-test" | grep -v grep | wc -l',
      { encoding: "utf-8", timeout: 2000 }
    );
    return parseInt(result?.trim() || "0", 10);
  } catch {
    return 0;
  }
}

/** Abort if too many test processes are already running */
export function guardAgainstRunawaySpawn(): void {
  const count = countTestProcesses();
  if (count > MAX_CONCURRENT_TEST_PROCS) {
    throw new Error(
      `Process guard triggered: ${count} test processes running (max ${MAX_CONCURRENT_TEST_PROCS}). ` +
        `Kill existing processes before running tests: killall -9 "bun test"`
    );
  }
}

/** Resolve the actual project root (repo root) even when run from a subdir */
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
  console.log(
    `  ${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`
  );
}

// ── Warning Trending (shared between memory and governance) ───────────

export interface DoctorWarning {
  check: string;
  message: string;
  severity: "warn" | "error";
}

export function recordDoctorRun(
  project: string,
  tool: string,
  warnings: DoctorWarning[],
  rScore?: number,
  gitHead?: string
) {
  const { Database } = require("bun:sqlite");
  const VAR_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "var");
  const DB_PATH = join(VAR_DIR, "sessions.db");

  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  const now = Date.now();

  db.run(
    `INSERT INTO doctor_runs (timestamp, tool, warnings_json, r_score, git_head, project)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [now, tool, JSON.stringify(warnings), rScore ?? null, gitHead ?? null, project]
  );

  for (const w of warnings) {
    const existing = db
      .query("SELECT occurrence_count FROM warning_trends WHERE check_name = ?")
      .get(w.check) as any;
    if (existing) {
      db.run(
        `UPDATE warning_trends SET last_seen = ?, occurrence_count = occurrence_count + 1, resolved_at = NULL
         WHERE check_name = ?`,
        [now, w.check]
      );
    } else {
      db.run(
        `INSERT INTO warning_trends (check_name, tool, first_seen, last_seen, occurrence_count)
         VALUES (?, ?, ?, ?, 1)`,
        [w.check, tool, now, now]
      );
    }
  }

  if (warnings.length > 0) {
    const checkNames = warnings.map((w) => w.check);
    const placeholders = checkNames.map(() => "?").join(",");
    db.run(
      `UPDATE warning_trends SET resolved_at = ?
       WHERE resolved_at IS NULL AND check_name NOT IN (${placeholders})`,
      [now, ...checkNames]
    );
  } else {
    db.run("UPDATE warning_trends SET resolved_at = ? WHERE resolved_at IS NULL", [now]);
  }

  db.close();
}

export function getPersistentWarnings(tool?: string): Array<{
  check_name: string;
  tool: string;
  occurrence_count: number;
  first_seen: number;
  last_seen: number;
  age_days: number;
}> {
  const { Database } = require("bun:sqlite");
  const VAR_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "var");
  const DB_PATH = join(VAR_DIR, "sessions.db");

  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  let rows;
  if (tool) {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
       FROM warning_trends WHERE resolved_at IS NULL AND tool = ?
       ORDER BY occurrence_count DESC`
      )
      .all(tool) as any[];
  } else {
    rows = db
      .query(
        `SELECT check_name, tool, occurrence_count, first_seen, last_seen
       FROM warning_trends WHERE resolved_at IS NULL
       ORDER BY occurrence_count DESC`
      )
      .all() as any[];
  }
  db.close();

  const now = Date.now();
  return rows.map((r) => ({
    check_name: r.check_name,
    tool: r.tool,
    occurrence_count: r.occurrence_count,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    age_days: Math.round((now - r.first_seen) / (24 * 60 * 60 * 1000)),
  }));
}
