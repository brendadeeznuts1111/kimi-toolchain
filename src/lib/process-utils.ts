#!/usr/bin/env bun
/**
 * process-utils — Orphan process detection and cleanup
 * Bun-native only. Zero dependencies.
 */

import { guardDir } from "./paths.ts";
import { join } from "path";
import { getCachedPs, clearProcessCache, countOrphanCandidates } from "./proc-cache.ts";

export interface ProcessInfo {
  pid: number;
  cmd: string;
  cpu: number;
}

// Re-export for backward compat
export { clearProcessCache, countOrphanCandidates };

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
