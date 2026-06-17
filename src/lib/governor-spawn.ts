/**
 * governedSpawn: Drop-in Bun.spawn replacement with resource limits
 */

import { nanoseconds } from "bun";
import { readableStreamToText } from "./bun-utils.ts";
import { DEFAULTS } from "./governor-state.ts";
import { getSessionId, updateSessionPeak } from "./governor-sessions.ts";

export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuTimeMs?: number;
  maxFileSizeMB?: number;
  maxOpenFiles?: number;
  wallClockMs?: number;
}

export interface ResourceUsage {
  memoryMB: number;
  cpuTimeMs: number;
  fileSizeMB: number;
  openFiles: number;
}

export function getCurrentUsage(): ResourceUsage {
  const memUsage = (process as any).memoryUsage?.() || { rss: 0 };
  const memoryMB = Math.round((memUsage.rss || 0) / 1024 / 1024);
  const cpuTimeMs = Math.round(performance.now());
  return { memoryMB, cpuTimeMs, fileSizeMB: 0, openFiles: 0 };
}

export function checkLimits(usage: ResourceUsage, limits: ResourceLimits): string[] {
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

// ── Process Tree Helpers ─────────────────────────────────────────────

/** Get all child PIDs of a given PID using pgrep (macOS/Linux) */
async function getChildPids(pid: number): Promise<number[]> {
  try {
    const result = await Bun.spawn({
      cmd: ["pgrep", "-P", String(pid)],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await readableStreamToText(result.stdout);
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
    const output = await readableStreamToText(result.stdout);
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

    // Retry backoff with jitter (skip on first attempt)
    if (attempt > 1) {
      const baseDelay = backoffMs * Math.pow(2, attempt - 2);
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.min(baseDelay + jitter, 30000); // cap at 30s
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
        readableStreamToText(proc.stdout),
        readableStreamToText(proc.stderr),
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
