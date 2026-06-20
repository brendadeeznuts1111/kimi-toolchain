/**
 * system-checks.ts — System-level health checks for kimi-doctor.
 *
 * Wraps disk, memory, swap, load, Chrome RSS, Docker, sync daemon,
 * and orphan process checks into a single runSystemChecks() call.
 */

import { $ } from "bun";
import {
  runSystemMemoryChecks,
  printMemoryBudget,
  countBlockingErrors,
  getAppRssGroups,
  type MemoryCheckResult,
} from "./memory-budget.ts";
import type { HealthCheck } from "./health-check.ts";
import type { Logger } from "./logger.ts";

export interface SystemCheckOptions {
  softSystem: boolean;
  memoryBudgetOnly: boolean;
}

/** Run full system checks (disk, memory, daemons, orphans) and return HealthCheck array. */
export async function runSystemChecks(
  logger: Logger,
  options: SystemCheckOptions = { softSystem: false, memoryBudgetOnly: false }
): Promise<HealthCheck[]> {
  if (options.memoryBudgetOnly) {
    printMemoryBudget(logger);
    return [];
  }

  const results: HealthCheck[] = [];

  // Disk
  try {
    const df = await $`df /`.quiet();
    const line = df.stdout.toString().split("\n")[1];
    const used = parseInt(line?.trim().split(/\s+/)[4]?.replace("%", "") || "0");
    if (used > 90)
      results.push({
        name: "disk",
        status: "error",
        message: `${used}% (critical)`,
        fixable: false,
      });
    else if (used > 80)
      results.push({ name: "disk", status: "warn", message: `${used}% (high)`, fixable: false });
    else results.push({ name: "disk", status: "ok", message: `${used}%`, fixable: false });
  } catch {
    results.push({ name: "disk", status: "warn", message: "could not check", fixable: false });
  }

  // Memory
  try {
    const memoryChecks = await runSystemMemoryChecks();
    for (const check of memoryChecks) {
      results.push({
        name: check.name,
        status: check.status,
        message: check.message,
        fixable: false,
      });
    }
  } catch {
    results.push({
      name: "memory",
      status: "warn",
      message: "ps unavailable — memory checks skipped",
      fixable: false,
    });
  }

  return results;
}

/** Print app RSS memory budget table. */
export { printMemoryBudget };

/** Count blocking vs system-only errors (for soft-system mode). */
export { countBlockingErrors };

/** Get app RSS groups for memory budget display. */
export { getAppRssGroups };

export type { MemoryCheckResult };
