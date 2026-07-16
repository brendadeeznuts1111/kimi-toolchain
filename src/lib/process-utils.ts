/**
 * process-utils — Orphan process cleanup
 * Bun-native only. Zero dependencies.
 */

import { guardDir } from "./paths.ts";
import { getOrphanCandidates, type OrphanProcessInfo } from "./proc-cache.ts";

export async function clearStaleLocks(): Promise<string[]> {
  const cleared: string[] = [];
  const locks = [`${guardDir()}/test-runner.pid`, `${guardDir()}/kimi-test.lock`];
  for (const lock of locks) {
    const file = Bun.file(lock);
    if (await file.exists()) {
      await file.delete();
      cleared.push(lock);
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
    process.kill(o.pid, "SIGTERM");
    killed++;
  }

  Bun.sleepSync(500);
  for (const o of getOrphanCandidates()) {
    process.kill(o.pid, "SIGKILL");
    killed++;
  }

  await clearStaleLocks();
  return { killed, orphans };
}
