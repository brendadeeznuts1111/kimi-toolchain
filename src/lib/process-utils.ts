#!/usr/bin/env bun
/**
 * process-utils — Orphan process detection and cleanup
 * Bun-native only. Zero dependencies.
 */

import { guardDir } from "./paths.ts";
import { join } from "path";

export interface ProcessInfo {
  pid: number;
  cmd: string;
  cpu: number;
}

const decoder = new TextDecoder();

/** Lightweight TTL cache for process data (avoids repeated ps calls). */
interface CacheEntry<T> {
  value: T;
  ts: number;
}
const _procCache = new Map<string, CacheEntry<string>>();
const CACHE_TTL_MS = 1000;

function getCachedPs(args: string[]): string {
  const key = args.join(" ");
  const now = Date.now();
  const entry = _procCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;

  try {
    const output = decoder.decode(Bun.spawnSync(["ps", ...args]).stdout);
    _procCache.set(key, { value: output, ts: now });
    return output;
  } catch {
    return "";
  }
}

export function clearProcessCache(): void {
  _procCache.clear();
}

export function getOrphanProcesses(): ProcessInfo[] {
  const output = getCachedPs(["aux"]);
  const orphans: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    if (
      line.includes("/.bun/bin/bun test") ||
      (line.includes("bun run") && line.includes("kimi-")) ||
      line.includes("/.kimi-code/bin/kimi --version") ||
      (line.includes("/bin/cp") && line.includes("kimi-test"))
    ) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const pid = parseInt(parts[1], 10);
        const cpu = parseFloat(parts[2]);
        const cmd = parts.slice(10).join(" ");
        if (!isNaN(pid) && pid !== process.pid) {
          orphans.push({ pid, cmd, cpu });
        }
      }
    }
  }
  return orphans;
}

export function countOrphanCandidates(): number {
  return getOrphanProcesses().length;
}

function killProcess(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGKILL") {
  try {
    process.kill(pid, signal === "SIGKILL" ? 9 : 15);
    return true;
  } catch {
    return false;
  }
}

export async function clearStaleLocks(): Promise<string[]> {
  const cleared: string[] = [];
  const locks = [join(guardDir(), "test-runner.pid"), join(guardDir(), "kimi-test.lock")];
  for (const lock of locks) {
    try {
      const file = Bun.file(lock);
      if (await file.exists()) {
        Bun.spawnSync(["rm", "-f", lock]);
        cleared.push(lock);
      }
    } catch {
      /* ignore */
    }
  }
  return cleared;
}

export async function runOrphanKill(
  dryRun = false
): Promise<{ killed: number; orphans: ProcessInfo[] }> {
  const orphans = getOrphanProcesses();
  if (orphans.length === 0) {
    await clearStaleLocks();
    return { killed: 0, orphans: [] };
  }

  if (dryRun) {
    return { killed: 0, orphans };
  }

  let killed = 0;
  for (const o of orphans) {
    if (killProcess(o.pid, "SIGTERM")) killed++;
  }

  Bun.sleepSync(500);
  for (const o of getOrphanProcesses()) {
    if (killProcess(o.pid, "SIGKILL")) killed++;
  }

  await clearStaleLocks();
  return { killed, orphans };
}
