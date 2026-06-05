#!/usr/bin/env bun
/**
 * kimi-resource-governor — Resource limits, parallelism, disk quota, diagnostic cache
 * v2.0: governedSpawn() export, wall-clock enforcement, session auto-track, kimi-doctor cache
 * P1: rlimit tracking, parallelism governor
 * P2: Disk quota, diagnostic cache with TTL
 *
 * Usage:
 *   kimi-resource-governor [limits|parallel|quota|cache|spawn|doctor|session|cleanup|status]
 *
 * Import:
 *   import { governedSpawn, ParallelGovernor, cachedExec, cachedDoctor, getSessionId } from "./kimi-resource-governor.ts";
 */

import { Database } from "bun:sqlite";
import { nanoseconds } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot } from "../lib/utils.ts";
import {
  loadGovernorDefaults,
  getGovernorConfigPath,
  DEFAULT_CONFIG_TEMPLATE,
  type GovernorDefaults,
} from "../lib/governor-config.ts";

// ── Config ───────────────────────────────────────────────────────────

const GOVERNOR_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "governor");
const DB_PATH = join(GOVERNOR_DIR, "resource-cache.sqlite");

let DEFAULTS: GovernorDefaults = {
  maxMemoryMB: 512,
  maxCpuTimeMs: 30000,
  maxFileSizeMB: 100,
  maxOpenFiles: 256,
  maxParallelJobs: Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)),
  diskQuotaMB: 1024,
  cacheTTLSeconds: 300,
  wallClockMs: 300000,
};

async function ensureDefaultsLoaded() {
  DEFAULTS = await loadGovernorDefaults();
}

interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuTimeMs?: number;
  maxFileSizeMB?: number;
  maxOpenFiles?: number;
  wallClockMs?: number;
}

interface ResourceUsage {
  memoryMB: number;
  cpuTimeMs: number;
  fileSizeMB: number;
  openFiles: number;
}

interface CacheEntry {
  key: string;
  command: string;
  output: string;
  createdAt: number;
  expiresAt: number;
}

interface SessionRecord {
  id: string;
  project: string;
  startedAt: number;
  endedAt?: number;
  memoryPeakMb: number;
  cpuTimeMs: number;
  diskUsedMb: number;
}

function normalizeCacheEntry(row: any): CacheEntry {
  return {
    key: row.key,
    command: row.command,
    output: row.output,
    createdAt: typeof row.created_at === "string" ? parseInt(row.created_at, 10) : row.created_at,
    expiresAt: typeof row.expires_at === "string" ? parseInt(row.expires_at, 10) : row.expires_at,
  };
}

// ── Session Management ───────────────────────────────────────────────

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = `${Bun.pid}-${Date.now()}`;
  }
  return _sessionId;
}

function startSession(project: string): SessionRecord {
  const id = getSessionId();
  const record: SessionRecord = {
    id,
    project,
    startedAt: Date.now(),
    memoryPeakMb: 0,
    cpuTimeMs: 0,
    diskUsedMb: 0,
  };
  const db = getDb();
  db.run(
    `INSERT INTO resource_sessions (id, project, started_at, memory_peak_mb, cpu_time_ms, disk_used_mb)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.project,
      record.startedAt,
      record.memoryPeakMb,
      record.cpuTimeMs,
      record.diskUsedMb,
    ]
  );
  db.close();
  return record;
}

function endSession(id: string) {
  const db = getDb();
  db.run(`UPDATE resource_sessions SET ended_at = ? WHERE id = ?`, [Date.now(), id]);
  db.close();
}

function updateSessionPeak(id: string, memoryMb: number, cpuMs: number) {
  const db = getDb();
  db.run(
    `UPDATE resource_sessions SET memory_peak_mb = MAX(memory_peak_mb, ?), cpu_time_ms = cpu_time_ms + ? WHERE id = ?`,
    [memoryMb, cpuMs, id]
  );
  db.close();
}

// ── Database ─────────────────────────────────────────────────────────

function getDb(): Database {
  if (!existsSync(GOVERNOR_DIR)) mkdirSync(GOVERNOR_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      memory_peak_mb REAL DEFAULT 0,
      cpu_time_ms REAL DEFAULT 0,
      disk_used_mb REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS diagnostic_cache (
      key TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON diagnostic_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON resource_sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_ended ON resource_sessions(ended_at);
  `);
  return db;
}

// ── Resource Monitoring ──────────────────────────────────────────────

function getCurrentUsage(): ResourceUsage {
  const memUsage = (process as any).memoryUsage?.() || { rss: 0 };
  const memoryMB = Math.round((memUsage.rss || 0) / 1024 / 1024);
  const cpuTimeMs = Math.round(performance.now());
  return { memoryMB, cpuTimeMs, fileSizeMB: 0, openFiles: 0 };
}

function checkLimits(usage: ResourceUsage, limits: ResourceLimits): string[] {
  const cfg = { ...DEFAULTS, ...limits };
  const violations: string[] = [];
  if (usage.memoryMB > cfg.maxMemoryMB!)
    violations.push(`Memory: ${usage.memoryMB}MB > ${cfg.maxMemoryMB}MB limit`);
  if (usage.cpuTimeMs > cfg.maxCpuTimeMs!)
    violations.push(`CPU time: ${usage.cpuTimeMs}ms > ${cfg.maxCpuTimeMs}ms limit`);
  if (usage.fileSizeMB > cfg.maxFileSizeMB!)
    violations.push(`File size: ${usage.fileSizeMB}MB > ${cfg.maxFileSizeMB}MB limit`);
  if (usage.openFiles > cfg.maxOpenFiles!)
    violations.push(`Open files: ${usage.openFiles} > ${cfg.maxOpenFiles} limit`);
  return violations;
}

// ── governedSpawn: Drop-in Bun.spawn replacement ─────────────────────

export interface GovernedSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  limits?: ResourceLimits;
  timeoutMs?: number;
  stdin?: Uint8Array | string;
  onResourceWarning?: (violations: string[]) => void;
  /** Kill entire process tree on timeout/memory limit (default: true) */
  killTree?: boolean;
  /** Retry config: max attempts and backoff multiplier in ms */
  retry?: { maxAttempts: number; backoffMs: number };
}

export interface GovernedSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  usage: ResourceUsage;
  killed: boolean;
  /** Number of retry attempts made (0 if no retry config) */
  attempts: number;
}

// ── Process Tree Helpers ─────────────────────────────────────────────

/** Get all child PIDs of a given PID using pgrep (macOS/Linux) */
async function getChildPids(pid: number): Promise<number[]> {
  try {
    const result = await Bun.spawn({
      cmd: ["pgrep", "-P", String(pid)],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await Bun.readableStreamToText(result.stdout);
    await result.exited;
    return output
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n !== pid);
  } catch {
    return [];
  }
}

/** Recursively collect all descendant PIDs (BFS) */
async function getProcessTreePids(pid: number): Promise<number[]> {
  const all = new Set<number>();
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (all.has(current)) continue;
    all.add(current);
    const children = await getChildPids(current);
    for (const child of children) {
      if (!all.has(child)) queue.push(child);
    }
  }
  all.delete(pid); // Don't include the root — caller handles it
  return Array.from(all);
}

/** Kill a process tree: SIGTERM all, wait, then SIGKILL survivors */
async function killProcessTree(rootPid: number, signal: "SIGTERM" | "SIGKILL") {
  const descendants = await getProcessTreePids(rootPid);
  for (const pid of descendants) {
    try {
      process.kill(pid, signal === "SIGTERM" ? 15 : 9);
    } catch {
      // Already dead or no permission — ignore
    }
  }
}

/** Get actual subprocess memory via ps (macOS/Linux) */
async function getSubprocessMemory(pid: number): Promise<number> {
  try {
    const result = await Bun.spawn({
      cmd: ["ps", "-o", "rss=", "-p", String(pid)],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await Bun.readableStreamToText(result.stdout);
    await result.exited;
    const kb = parseInt(output.trim(), 10);
    return isNaN(kb) ? 0 : Math.round(kb / 1024); // MB
  } catch {
    return 0;
  }
}

/** Get total RSS of a process tree */
async function getTreeMemory(pid: number): Promise<number> {
  const descendants = await getProcessTreePids(pid);
  const allPids = [pid, ...descendants];
  let totalMB = 0;
  for (const p of allPids) {
    totalMB += await getSubprocessMemory(p);
  }
  return totalMB;
}

// ── governedSpawn: Drop-in Bun.spawn replacement ─────────────────────

export async function governedSpawn(
  command: string[],
  options: GovernedSpawnOptions = {}
): Promise<GovernedSpawnResult> {
  const limits = { ...DEFAULTS, ...options.limits };
  const timeoutMs = options.timeoutMs ?? limits.wallClockMs;
  const killTree = options.killTree !== false; // default true
  const maxAttempts = options.retry?.maxAttempts ?? 1;
  const backoffMs = options.retry?.backoffMs ?? 1000;

  let lastError: Error | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;

    // Retry backoff (skip on first attempt)
    if (attempt > 1) {
      const delay = backoffMs * Math.pow(2, attempt - 2);
      await Bun.sleep(delay);
    }

    try {
      const current = getCurrentUsage();
      const preViolations = checkLimits(current, limits);
      if (preViolations.length > 0) {
        throw new Error(`Resource limit pre-check failed: ${preViolations.join(", ")}`);
      }

      const startTime = nanoseconds();
      const sessionId = getSessionId();

      const proc = Bun.spawn(command, {
        cwd: options.cwd,
        env: { ...Bun.env, ...options.env },
        stdout: "pipe",
        stderr: "pipe",
        stdin: options.stdin
          ? typeof options.stdin === "string"
            ? new TextEncoder().encode(options.stdin)
            : options.stdin
          : undefined,
      });

      const rootPid = proc.pid;
      let killed = false;
      let killReason: "timeout" | "memory" | null = null;
      let killFallbackId: Timer | null = null;

      // Wall-clock timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        killReason = "timeout";
        proc.kill("SIGTERM");
        if (killTree) killProcessTree(rootPid, "SIGTERM");
        killFallbackId = setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
            if (killTree) killProcessTree(rootPid, "SIGKILL");
          }
        }, 5000);
      }, timeoutMs);

      // Memory monitor: checks actual subprocess tree RSS every second
      const monitorId = setInterval(async () => {
        const treeMem = await getTreeMemory(rootPid);
        updateSessionPeak(sessionId, treeMem, 0);

        if (limits.maxMemoryMB && treeMem > limits.maxMemoryMB) {
          killed = true;
          killReason = "memory";
          clearInterval(monitorId);
          clearTimeout(timeoutId);
          proc.kill("SIGTERM");
          if (killTree) killProcessTree(rootPid, "SIGTERM");
          killFallbackId = setTimeout(() => {
            if (!proc.killed) {
              proc.kill("SIGKILL");
              if (killTree) killProcessTree(rootPid, "SIGKILL");
            }
          }, 5000);
        }
      }, 1000);

      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([
        Bun.readableStreamToText(proc.stdout),
        Bun.readableStreamToText(proc.stderr),
      ]);

      clearTimeout(timeoutId);
      clearInterval(monitorId);
      if (killFallbackId) clearTimeout(killFallbackId);

      const endTime = nanoseconds();
      const finalTreeMem = await getTreeMemory(rootPid);

      const usage: ResourceUsage = {
        memoryMB: finalTreeMem,
        cpuTimeMs: Math.round((endTime - startTime) / 1_000_000),
        fileSizeMB: 0,
        openFiles: 0,
      };

      updateSessionPeak(sessionId, usage.memoryMB, usage.cpuTimeMs);

      const violations = checkLimits(usage, limits);
      if (violations.length > 0 && options.onResourceWarning) {
        options.onResourceWarning(violations);
      }

      // Don't retry on successful execution
      return {
        stdout,
        stderr,
        exitCode,
        signal: killed ? (killReason === "timeout" ? "SIGTERM" : "SIGTERM") : undefined,
        usage,
        killed,
        attempts,
      };
    } catch (err: any) {
      lastError = err;
      // Only retry on spawn/resource errors, not on non-zero exit codes
      // (non-zero exits are handled above in the return path)
      if (attempt < maxAttempts) {
        continue;
      }
      break;
    }
  }

  throw lastError || new Error(`governedSpawn failed after ${attempts} attempt(s)`);
}

// ── Parallelism Governor ─────────────────────────────────────────────

export class ParallelGovernor {
  private semaphore: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent = DEFAULTS.maxParallelJobs) {
    this.semaphore = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.semaphore > 0) {
      this.semaphore--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.semaphore++;
    }
  }

  get available() {
    return this.semaphore;
  }

  get queued() {
    return this.queue.length;
  }
}

// ── Disk Quota ───────────────────────────────────────────────────────

async function getDiskUsage(dir: string): Promise<number> {
  try {
    const result = await governedSpawn(["du", "-sk", dir]);
    const kb = parseInt(result.stdout.split(/\s+/)[0], 10);
    return Math.round(kb / 1024);
  } catch {
    return 0;
  }
}

export async function checkDiskQuota(
  projectDir: string,
  quotaMB = DEFAULTS.diskQuotaMB
): Promise<{ used: number; remaining: number; ok: boolean }> {
  const used = await getDiskUsage(projectDir);
  const remaining = quotaMB - used;
  return { used, remaining, ok: remaining > 0 };
}

// ── Diagnostic Cache ─────────────────────────────────────────────────

function hashCommand(command: string, args: string[], cwd: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify({ command, args, cwd }));
  return hasher.digest("hex").slice(0, 16);
}

function getCached(key: string): CacheEntry | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM diagnostic_cache WHERE key = ? AND expires_at > ?")
    .get(key, Date.now()) as any;
  db.close();
  return row ? normalizeCacheEntry(row) : null;
}

function setCached(
  key: string,
  command: string,
  output: string,
  ttlSeconds = DEFAULTS.cacheTTLSeconds
) {
  const db = getDb();
  const now = Date.now();
  const expires = now + ttlSeconds * 1000;
  db.run(
    "INSERT OR REPLACE INTO diagnostic_cache (key, command, output, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [key, command, output, now, expires]
  );
  db.close();
}

function cleanupCache(): number {
  const db = getDb();
  const result = db.run("DELETE FROM diagnostic_cache WHERE expires_at < ?", [Date.now()]);
  const deleted = result.changes;
  db.close();
  return deleted;
}

export async function cachedExec(
  command: string[],
  options?: { cwd?: string; ttl?: number; force?: boolean }
): Promise<string> {
  const cwd = options?.cwd || Bun.cwd;
  const key = hashCommand(command[0], command.slice(1), cwd);

  if (!options?.force) {
    const cached = getCached(key);
    if (cached) {
      console.log(`  💾 Cache hit: ${command.join(" ")}`);
      return cached.output;
    }
  }

  console.log(`  🔄 Cache miss: ${command.join(" ")}`);
  const result = await governedSpawn(command, { cwd });
  const output = result.stdout || result.stderr;

  setCached(key, command.join(" "), output, options?.ttl);
  return output;
}

export async function cachedDoctor(
  checkName: string,
  fn: () => Promise<string>,
  ttlSeconds = DEFAULTS.cacheTTLSeconds
): Promise<string> {
  const key = hashCommand("kimi-doctor", [checkName], Bun.cwd);

  const cached = getCached(key);
  if (cached) {
    const ageSeconds = Math.round((Date.now() - cached.createdAt) / 1000);
    console.log(`  💾 Doctor cache hit: ${checkName} (${ageSeconds}s old)`);
    return cached.output;
  }

  console.log(`  🔄 Doctor cache miss: ${checkName}`);
  const output = await fn();
  setCached(key, `kimi-doctor:${checkName}`, output, ttlSeconds);
  return output;
}

// ── Doctor ───────────────────────────────────────────────────────────

function doctor(): Array<{
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  let db: Database | null = null;
  try {
    db = getDb();
    checks.push({
      name: "db-access",
      status: "ok",
      message: "Database accessible",
      fixable: false,
    });
  } catch (e: any) {
    checks.push({
      name: "db-access",
      status: "error",
      message: `Cannot open DB: ${e.message}`,
      fixable: false,
    });
    return checks;
  }

  // Cache health
  const cacheCount = (db.query("SELECT COUNT(*) as c FROM diagnostic_cache").get() as any).c;
  const expiredCount = (
    db
      .query("SELECT COUNT(*) as c FROM diagnostic_cache WHERE expires_at < ?")
      .get(Date.now()) as any
  ).c;
  checks.push({
    name: "cache",
    status: expiredCount > cacheCount * 0.5 ? "warn" : "ok",
    message: `${cacheCount} entries (${expiredCount} expired)`,
    fixable: expiredCount > 0,
  });

  // Stuck sessions
  const stuck = db
    .query("SELECT COUNT(*) as c FROM resource_sessions WHERE ended_at IS NULL AND started_at < ?")
    .get(Date.now() - DEFAULTS.wallClockMs * 2) as any;
  checks.push({
    name: "stuck-sessions",
    status: stuck.c > 0 ? "warn" : "ok",
    message: `${stuck.c} stuck session(s)`,
    fixable: stuck.c > 0,
  });

  // WAL size
  const walPath = DB_PATH + "-wal";
  if (existsSync(walPath)) {
    const walMB = Bun.file(walPath).size / 1024 / 1024;
    checks.push({
      name: "wal-size",
      status: walMB > 10 ? "warn" : "ok",
      message: `${walMB.toFixed(1)}MB WAL`,
      fixable: walMB > 10,
    });
  } else {
    checks.push({ name: "wal-size", status: "ok", message: "No WAL", fixable: false });
  }

  db.close();
  return checks;
}

// ── Fix ──────────────────────────────────────────────────────────────

function fixGovernor() {
  const db = getDb();

  // Clean expired cache
  const cacheResult = db.run("DELETE FROM diagnostic_cache WHERE expires_at < ?", [Date.now()]);
  const cacheDeleted = cacheResult.changes;

  // End stuck sessions
  const stuckResult = db.run(
    "UPDATE resource_sessions SET ended_at = ? WHERE ended_at IS NULL AND started_at < ?",
    [Date.now(), Date.now() - DEFAULTS.wallClockMs * 2]
  );
  const stuckFixed = stuckResult.changes;

  db.exec("VACUUM;");
  db.close();

  return { cacheDeleted, stuckFixed };
}

// ── Main CLI ─────────────────────────────────────────────────────────

async function main() {
  await ensureDefaultsLoaded();
  const args = Bun.argv.slice(2);
  const command = args[0] || "status";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = getProjectName(projectDir);

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Resource Governor v2.0                        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  if (command === "limits") {
    console.log("── Current Resource Usage ────────────────────────────────────");
    const usage = getCurrentUsage();
    console.log(`  Memory:     ${usage.memoryMB}MB / ${DEFAULTS.maxMemoryMB}MB`);
    console.log(`  CPU time:   ${usage.cpuTimeMs}ms / ${DEFAULTS.maxCpuTimeMs}ms`);
    console.log(`  File size:  ${usage.fileSizeMB}MB / ${DEFAULTS.maxFileSizeMB}MB`);
    console.log(`  Open files: ${usage.openFiles} / ${DEFAULTS.maxOpenFiles}`);

    const violations = checkLimits(usage, {});
    if (violations.length > 0) {
      console.log("  ⚠ Violations:");
      for (const v of violations) console.log(`    ${v}`);
    } else {
      console.log("  ✓ Within limits");
    }
  } else if (command === "parallel") {
    console.log("── Parallelism Governor ──────────────────────────────────────");
    console.log(`  Hardware concurrency: ${navigator.hardwareConcurrency || "unknown"}`);
    console.log(`  Max parallel jobs:    ${DEFAULTS.maxParallelJobs}`);

    const gov = new ParallelGovernor();
    console.log(`  Available slots:      ${gov.available}`);

    const tasks = [1, 2, 3, 4].map((i) =>
      gov.run(async () => {
        console.log(`    Task ${i} starting (slots: ${gov.available}, queued: ${gov.queued})...`);
        await Bun.sleep(500);
        console.log(`    Task ${i} done`);
        return i;
      })
    );

    await Promise.all(tasks);
    console.log("  ✓ All tasks completed");
  } else if (command === "quota") {
    console.log(`── Disk Quota: ${project} ────────────────────────────────────`);
    const { used, remaining, ok } = await checkDiskQuota(projectDir);
    console.log(`  Used:      ${used}MB`);
    console.log(`  Quota:     ${DEFAULTS.diskQuotaMB}MB`);
    console.log(`  Remaining: ${remaining}MB`);
    console.log(ok ? "  ✓ Within quota" : "  ✗ Quota exceeded");
  } else if (command === "spawn") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      console.log("Usage: spawn <command> [args...]");
      process.exit(1);
    }
    console.log("── governedSpawn ─────────────────────────────────────────────");
    const result = await governedSpawn(cmd, {
      onResourceWarning: (v) => console.log(`  ⚠ ${v.join(", ")}`),
    });
    console.log(`  Exit code: ${result.exitCode}`);
    console.log(`  Killed:    ${result.killed}`);
    console.log(`  Memory:    ${result.usage.memoryMB}MB`);
    console.log(`  CPU:       ${result.usage.cpuTimeMs}ms`);
    console.log(`  Attempts:  ${result.attempts}`);
    if (result.stdout) {
      console.log("  stdout:");
      console.log(
        result.stdout
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")
      );
    }
  } else if (command === "retry") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      console.log("Usage: retry <command> [args...]");
      console.log("Demonstrates retry with exponential backoff (max 3 attempts)");
      process.exit(1);
    }
    console.log("── governedSpawn with retry ──────────────────────────────────");
    try {
      const result = await governedSpawn(cmd, {
        retry: { maxAttempts: 3, backoffMs: 500 },
        onResourceWarning: (v) => console.log(`  ⚠ ${v.join(", ")}`),
      });
      console.log(`  Exit code: ${result.exitCode}`);
      console.log(`  Attempts:  ${result.attempts}`);
      console.log(`  Memory:    ${result.usage.memoryMB}MB`);
      if (result.stdout) {
        console.log("  stdout:");
        console.log(
          result.stdout
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")
        );
      }
    } catch (err: any) {
      console.log(`  ✗ Failed after retries: ${err.message}`);
    }
  } else if (command === "cache") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      console.log("Usage: cache <command> [args...]");
      console.log("Examples:");
      console.log("  cache bun --version");
      console.log("  cache --force bun --version  (bypass cache)");
      process.exit(1);
    }

    const force = cmd[0] === "--force";
    const actualCmd = force ? cmd.slice(1) : cmd;

    console.log("── Diagnostic Cache ──────────────────────────────────────────");
    const output = await cachedExec(actualCmd, { force });
    console.log("  Output:");
    console.log(
      output
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")
    );
  } else if (command === "doctor") {
    const checks = doctor();
    console.log("── Resource Governor Doctor ──────────────────────────────────");
    let errors = 0,
      warns = 0,
      fixable = 0;
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
    if (fixable > 0) {
      console.log("  Run 'kimi-resource-governor fix' to repair");
    }
  } else if (command === "fix") {
    console.log("── Fixing Resource Governor ──────────────────────────────────");
    ensureDir(GOVERNOR_DIR);
    const configPath = getGovernorConfigPath();
    if (!existsSync(configPath)) {
      await Bun.write(configPath, DEFAULT_CONFIG_TEMPLATE);
      console.log(`  ✓ Wrote default config: ${configPath}`);
      await ensureDefaultsLoaded();
    }
    const result = fixGovernor();
    console.log(`  ✓ Cleaned ${result.cacheDeleted} expired cache entries`);
    console.log(`  ✓ Ended ${result.stuckFixed} stuck sessions`);
    console.log(`  ✓ Database vacuumed`);
  } else if (command === "session") {
    console.log("── Session Management ────────────────────────────────────────");
    const id = getSessionId();
    console.log(`  Session ID: ${id}`);

    const db = getDb();
    const active = db
      .query("SELECT COUNT(*) as c FROM resource_sessions WHERE ended_at IS NULL")
      .get() as any;
    const total = db.query("SELECT COUNT(*) as c FROM resource_sessions").get() as any;
    db.close();

    console.log(`  Active sessions: ${active.c}`);
    console.log(`  Total sessions:  ${total.c}`);

    startSession(project);
    console.log(`  ✓ Session started for ${project}`);
  } else if (command === "cleanup") {
    console.log("── Cache Cleanup ─────────────────────────────────────────────");
    const deleted = cleanupCache();
    console.log(`  Removed ${deleted} expired cache entries`);
  } else if (command === "status") {
    console.log("── Defaults ──────────────────────────────────────────────────");
    console.log(`  Config file:       ${getGovernorConfigPath()}`);
    console.log(`  Max memory:        ${DEFAULTS.maxMemoryMB}MB`);
    console.log(`  Max CPU time:      ${DEFAULTS.maxCpuTimeMs}ms`);
    console.log(`  Max file size:     ${DEFAULTS.maxFileSizeMB}MB`);
    console.log(`  Max open files:    ${DEFAULTS.maxOpenFiles}`);
    console.log(`  Max parallel:      ${DEFAULTS.maxParallelJobs}`);
    console.log(`  Disk quota:        ${DEFAULTS.diskQuotaMB}MB`);
    console.log(`  Cache TTL:         ${DEFAULTS.cacheTTLSeconds}s`);
    console.log(`  Wall-clock limit:  ${DEFAULTS.wallClockMs}ms`);
    console.log("");
    console.log("Commands:");
    console.log("  limits          Show current resource usage");
    console.log("  parallel        Test parallelism governor");
    console.log("  quota           Check disk quota");
    console.log("  spawn <cmd>     Run command with governedSpawn (tree-kill, ps memory)");
    console.log("  retry <cmd>     Run command with retry + exponential backoff");
    console.log("  cache <cmd>     Cached command execution");
    console.log("  doctor          Check governor health");
    console.log("  fix             Clean cache, end stuck sessions, vacuum");
    console.log("  session         Start/manage sessions");
    console.log("  cleanup         Remove expired cache entries");
    console.log("");
    console.log("Import in your code:");
    console.log(
      "  import { governedSpawn, ParallelGovernor, cachedExec, cachedDoctor } from './kimi-resource-governor.ts'"
    );
    console.log("");
    console.log("New spawn options:");
    console.log("  killTree: false       — disable process tree cleanup");
    console.log("  retry: { maxAttempts, backoffMs } — exponential backoff retry");
  }
}

// Auto-end session on graceful exit
async function gracefulShutdown(_signal: string) {
  if (_sessionId) {
    endSession(_sessionId);
  }
  await Bun.sleep(50);
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
process.on("beforeExit", () => {
  if (_sessionId) endSession(_sessionId);
});

main().catch((err) => {
  console.error("Governor failed:", err.message);
  process.exit(1);
});
