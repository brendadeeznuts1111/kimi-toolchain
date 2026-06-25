/**
 * Process tree helpers used by tool-runner.ts for cleanup.
 */

import { getCachedCommandOutputAsync } from "./proc-cache.ts";
import { DEFAULTS } from "./governor-state.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";
import { nowMs } from "./timing.ts";
import { readableStreamToText } from "./bun-utils.ts";

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
  const mem = process.memoryUsage();
  return {
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    cpuTimeMs: Math.round(nowMs()),
    fileSizeMB: 0,
    openFiles: 0,
  };
}

export function checkLimits(usage: ResourceUsage, limits: ResourceLimits): string[] {
  const cfg = { ...DEFAULTS, ...limits };
  const violations: string[] = [];
  if (usage.memoryMB > cfg.maxMemoryMB!) {
    violations.push(`Memory: ${usage.memoryMB}MB > ${cfg.maxMemoryMB}MB limit`);
  }
  if (usage.cpuTimeMs > cfg.maxCpuTimeMs!) {
    violations.push(`CPU time: ${usage.cpuTimeMs}ms > ${cfg.maxCpuTimeMs}ms limit`);
  }
  if (usage.fileSizeMB > cfg.maxFileSizeMB!) {
    violations.push(`File size: ${usage.fileSizeMB}MB > ${cfg.maxFileSizeMB}MB limit`);
  }
  if (usage.openFiles > cfg.maxOpenFiles!) {
    violations.push(`Open files: ${usage.openFiles} > ${cfg.maxOpenFiles} limit`);
  }
  return violations;
}

/** Kill a process tree: SIGTERM all, wait, then SIGKILL survivors */
export async function killProcessTree(rootPid: number, signal: "SIGTERM" | "SIGKILL") {
  const all = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (all.has(current)) continue;
    all.add(current);
    const output = await getCachedCommandOutputAsync("pgrep", ["-P", String(current)]).catch(
      () => ""
    );
    const children = output
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n !== current);
    for (const child of children) {
      if (!all.has(child)) queue.push(child);
    }
  }
  all.delete(rootPid);
  for (const pid of all) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export interface GovernedSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  limits?: ResourceLimits;
  timeoutMs?: number;
  stdin?: Uint8Array | string;
  onResourceWarning?: (violations: string[]) => void;
  killTree?: boolean;
  retry?: { maxAttempts: number; backoffMs: number };
}

export interface GovernedSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  usage: ResourceUsage;
  killed: boolean;
  attempts: number;
}

export async function governedSpawn(
  command: string[],
  options: GovernedSpawnOptions = {}
): Promise<GovernedSpawnResult> {
  const limits = { ...DEFAULTS, ...options.limits };
  const timeoutMs = options.timeoutMs ?? limits.wallClockMs;
  const maxAttempts = options.retry?.maxAttempts ?? 1;
  const backoffMs = options.retry?.backoffMs ?? 1000;
  let lastError: Error | undefined;

  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    if (attempts > 1) await Bun.sleep(Math.min(backoffMs * 2 ** (attempts - 2), 30_000));

    try {
      const preViolations = checkLimits(getCurrentUsage(), limits);
      if (preViolations.length > 0) {
        throw new Error(`Resource limit pre-check failed: ${preViolations.join(", ")}`);
      }

      const start = Bun.nanoseconds();
      let killed = false;
      const proc = Bun.spawn(command, {
        cwd: options.cwd,
        env: { ...withNoOrphansEnv(), ...options.env },
        stdout: "pipe",
        stderr: "pipe",
        stdin:
          typeof options.stdin === "string"
            ? new TextEncoder().encode(options.stdin)
            : options.stdin,
      });

      const timeout = setTimeout(() => {
        killed = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
        if (options.killTree !== false) void killProcessTree(proc.pid, "SIGTERM");
      }, timeoutMs);

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        readableStreamToText(proc.stdout),
        readableStreamToText(proc.stderr),
      ]);
      clearTimeout(timeout);

      const usage: ResourceUsage = {
        memoryMB: getCurrentUsage().memoryMB,
        cpuTimeMs: Math.round((Bun.nanoseconds() - start) / 1_000_000),
        fileSizeMB: 0,
        openFiles: 0,
      };
      const violations = checkLimits(usage, limits);
      if (violations.length > 0) options.onResourceWarning?.(violations);
      return {
        stdout,
        stderr,
        exitCode,
        signal: killed ? "SIGTERM" : undefined,
        usage,
        killed,
        attempts,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempts === maxAttempts) break;
    }
  }

  throw lastError ?? new Error(`governedSpawn failed after ${maxAttempts} attempt(s)`);
}
