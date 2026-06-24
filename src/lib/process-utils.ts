/**
 * process-utils — Orphan process cleanup
 * Bun-native only. Zero dependencies.
 */

import { guardDir } from "./paths.ts";
import { join } from "path";
import { getOrphanCandidates, type OrphanProcessInfo } from "./proc-cache.ts";

export async function clearStaleLocks(): Promise<string[]> {
  const cleared: string[] = [];
  const locks = [join(guardDir(), "test-runner.pid"), join(guardDir(), "kimi-test.lock")];
  for (const lock of locks) {
    try {
      await Bun.file(lock).delete();
      cleared.push(lock);
    } catch {
      // Lock absent or unprivileged — ignore.
    }
  }
  return cleared;
}

export async function runOrphanKill(
  dryRun = false
): Promise<{ killed: number; orphans: OrphanProcessInfo[] }> {
  const orphans = getOrphanCandidates();
  if (orphans.length === 0) {
    await clearStaleLocks();
    return { killed: 0, orphans: [] };
  }

  if (dryRun) {
    return { killed: 0, orphans };
  }

  let killed = 0;
  for (const o of orphans) {
    try {
      process.kill(o.pid, "SIGTERM");
      killed++;
    } catch {
      // Already dead or no permission — ignore
    }
  }

  Bun.sleepSync(500);
  for (const o of getOrphanCandidates()) {
    try {
      process.kill(o.pid, "SIGKILL");
      killed++;
    } catch {
      // Already dead or no permission — ignore
    }
  }

  await clearStaleLocks();
  return { killed, orphans };
}
