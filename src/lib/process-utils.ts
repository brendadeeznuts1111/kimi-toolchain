#!/usr/bin/env bun
/**
 * process-utils — Orphan process detection and cleanup
 * Bun-native only. Zero dependencies.
 */

import { guardDir } from "./paths.ts";
import { join } from "path";
import { clearProcessCache, countOrphanCandidates, getOrphanCandidates } from "./proc-cache.ts";

export interface ProcessInfo {
  pid: number;
  cmd: string;
  cpu: number;
}

// Re-export for backward compat
export { clearProcessCache, countOrphanCandidates };

export function getOrphanProcesses(): ProcessInfo[] {
  return getOrphanCandidates().map(({ pid, cmd, cpu }) => ({ pid, cmd, cpu }));
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
