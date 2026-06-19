/**
 * System memory budget helpers for kimi-doctor and monitoring scripts.
 */

import { $ } from "bun";
import { createLogger, type Logger } from "./logger.ts";
import {
  getCachedCommandOutput,
  getCachedPs,
  getCachedPsAsync,
  clearProcessCache,
  countOrphanCandidates,
} from "./proc-cache.ts";

const decoder = new TextDecoder();

// Re-export for consumers that imported clearProcessCache from here
export { clearProcessCache };

export interface MemoryCheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
}

/** System/environment checks that should not block unify when --soft-system is set. */
export const SOFT_SYSTEM_CHECK_NAMES = new Set([
  "memory-free",
  "swap-used",
  "memory-pressure",
  "chrome-rss",
  "load-per-core",
]);

export function countBlockingErrors(
  results: Array<{ name: string; status: string }>,
  softSystem: boolean
): { blocking: number; system: number; total: number } {
  let blocking = 0;
  let system = 0;
  for (const r of results) {
    if (r.status !== "error") continue;
    if (softSystem && SOFT_SYSTEM_CHECK_NAMES.has(r.name)) system++;
    else blocking++;
  }
  return { blocking, system, total: blocking + system };
}

export interface AppRssGroup {
  label: string;
  mb: number;
  processes: number;
}

const APP_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Google Chrome", pattern: /Google Chrome/i },
  { label: "cursor-agent", pattern: /cursor-agent/i },
  { label: "Cursor IDE", pattern: /\/Applications\/Cursor\.app/i },
  { label: "kimi CLI", pattern: /\/\.kimi-code\/bin\/kimi|\/kimi-code\/bin\/kimi/ },
  { label: "Kimi Desktop", pattern: /\/Applications\/Kimi\.app/i },
  { label: "Docker", pattern: /Docker|com\.docker/i },
  { label: "Telegram", pattern: /Telegram/i },
  { label: "Ghostty", pattern: /ghostty/i },
];

export async function getFreeMemoryMB(): Promise<number> {
  const vmstat = await $`vm_stat`.quiet();
  const freeMatch = vmstat.stdout.toString().match(/Pages free:\s*(\d+)/);
  const freePages = parseInt(freeMatch?.[1] || "0", 10);
  return Math.round((freePages * 16384) / 1024 / 1024);
}

export async function getSwapUsedMB(): Promise<number> {
  const out = await $`sysctl -n vm.swapusage`.quiet();
  const match = out.stdout.toString().match(/used\s*=\s*([\d.]+)M/i);
  return match ? Math.round(parseFloat(match[1])) : 0;
}

export async function getMemoryPressureFreePct(): Promise<number | null> {
  try {
    const out = await $`memory_pressure -Q`.quiet();
    const match = out.stdout.toString().match(/free percentage:\s*(\d+)%/i);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

export async function getLoadPerCore(): Promise<{ load: number; cores: number; perCore: number }> {
  const [uptime, ncpu] = await Promise.all([$`uptime`.quiet(), $`sysctl -n hw.ncpu`.quiet()]);
  const loadMatch = uptime.stdout.toString().match(/load averages?:\s*([\d.]+)/);
  const load = parseFloat(loadMatch?.[1] || "0");
  const cores = parseInt(ncpu.stdout.toString().trim() || "1", 10) || 1;
  return { load, cores, perCore: load / cores };
}

export function getChromeRssMB(): number {
  return getRssByPattern(/Google Chrome/i);
}

export function getAppRssGroups(): AppRssGroup[] {
  const output = getCachedPs(["-axo", "rss,command"]);
  const totals = new Map<string, { mb: number; count: number }>();

  for (const line of output.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    if (space < 0) continue;
    const rss = parseInt(trimmed.slice(0, space), 10);
    const cmd = trimmed.slice(space + 1);
    if (isNaN(rss)) continue;

    for (const { label, pattern } of APP_PATTERNS) {
      if (pattern.test(cmd)) {
        const cur = totals.get(label) ?? { mb: 0, count: 0 };
        cur.mb += rss / 1024;
        cur.count += 1;
        totals.set(label, cur);
        break;
      }
    }
  }

  return [...totals.entries()]
    .map(([label, v]) => ({
      label,
      mb: Math.round(v.mb),
      processes: v.count,
    }))
    .sort((a, b) => b.mb - a.mb);
}

function getRssByPattern(pattern: RegExp): number {
  const output = getCachedPs(["-axo", "rss,command"]);
  let total = 0;
  for (const line of output.split("\n")) {
    if (pattern.test(line)) {
      const rss = parseInt(line.trim().split(/\s+/)[0] || "0", 10);
      if (!isNaN(rss)) total += rss;
    }
  }
  return Math.round(total / 1024);
}

export function isDockerDesktopRunning(): boolean {
  const output = getCachedCommandOutput("pgrep", ["-lf", "Docker|com.docker"]);
  return output.trim().length > 0;
}

export function isDockerCliInstalled(): boolean {
  try {
    const out = decoder.decode(Bun.spawnSync(["which", "docker"]).stdout);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export function isSyncDaemonRunning(): boolean {
  const output = getCachedCommandOutput("pgrep", ["-lf", "sync-to-desktop"]);
  return output.trim().length > 0;
}

// countOrphanCandidates re-exported from proc-cache.ts above

export async function runSystemMemoryChecks(): Promise<MemoryCheckResult[]> {
  const results: MemoryCheckResult[] = [];
  let pressurePct: number | null = null;

  await getCachedPsAsync(["-axo", "rss,command"]);

  try {
    pressurePct = await getMemoryPressureFreePct();
  } catch {
    pressurePct = null;
  }

  try {
    const freeMB = await getFreeMemoryMB();
    const pressureContext = pressurePct === null ? "" : `; pressure ${pressurePct}% free`;

    if (freeMB < 500 && pressurePct !== null && pressurePct >= 50) {
      results.push({
        name: "memory-free",
        status: "ok",
        message: `~${freeMB}MB free pages${pressureContext}`,
      });
    } else if (freeMB < 500 && pressurePct !== null && pressurePct >= 30) {
      results.push({
        name: "memory-free",
        status: "warn",
        message: `~${freeMB}MB free pages${pressureContext}`,
      });
    } else if (freeMB < 500) {
      results.push({
        name: "memory-free",
        status: "error",
        message: `~${freeMB}MB free (critical)`,
      });
    } else if (freeMB < 1024) {
      results.push({
        name: "memory-free",
        status: "warn",
        message: `~${freeMB}MB free pages${pressureContext}`,
      });
    } else {
      results.push({
        name: "memory-free",
        status: "ok",
        message: `~${freeMB}MB free pages${pressureContext}`,
      });
    }
  } catch {
    results.push({ name: "memory-free", status: "warn", message: "could not check" });
  }

  try {
    const swapMB = await getSwapUsedMB();
    if (swapMB > 1024)
      results.push({ name: "swap-used", status: "error", message: `${swapMB}MB swap in use` });
    else if (swapMB > 500)
      results.push({ name: "swap-used", status: "warn", message: `${swapMB}MB swap in use` });
    else results.push({ name: "swap-used", status: "ok", message: `${swapMB}MB swap in use` });
  } catch {
    results.push({ name: "swap-used", status: "warn", message: "could not check" });
  }

  try {
    const pct = pressurePct;
    if (pct === null) {
      results.push({ name: "memory-pressure", status: "warn", message: "could not check" });
    } else if (pct < 30) {
      results.push({
        name: "memory-pressure",
        status: "error",
        message: `${pct}% system memory free`,
      });
    } else if (pct < 50) {
      results.push({
        name: "memory-pressure",
        status: "warn",
        message: `${pct}% system memory free`,
      });
    } else {
      results.push({
        name: "memory-pressure",
        status: "ok",
        message: `${pct}% system memory free`,
      });
    }
  } catch {
    results.push({ name: "memory-pressure", status: "warn", message: "could not check" });
  }

  try {
    const { load, cores, perCore } = await getLoadPerCore();
    const msg = `${load} (${perCore.toFixed(1)}/core, ${cores} cores)`;
    if (perCore > 4) results.push({ name: "load-per-core", status: "error", message: msg });
    else if (perCore > 2) results.push({ name: "load-per-core", status: "warn", message: msg });
    else results.push({ name: "load-per-core", status: "ok", message: msg });
  } catch {
    results.push({ name: "load-per-core", status: "warn", message: "could not check" });
  }

  try {
    const chromeMB = getChromeRssMB();
    if (chromeMB > 4096)
      results.push({ name: "chrome-rss", status: "error", message: `${chromeMB}MB RSS` });
    else if (chromeMB > 2048)
      results.push({ name: "chrome-rss", status: "warn", message: `${chromeMB}MB RSS` });
    else if (chromeMB > 0)
      results.push({ name: "chrome-rss", status: "ok", message: `${chromeMB}MB RSS` });
    else results.push({ name: "chrome-rss", status: "ok", message: "not running" });
  } catch {
    results.push({ name: "chrome-rss", status: "warn", message: "could not check" });
  }

  if (isDockerDesktopRunning()) {
    results.push({
      name: "docker-desktop",
      status: "warn",
      message: "Docker Desktop is running — quit to save ~600MB RAM",
    });
  } else if (isDockerCliInstalled()) {
    results.push({
      name: "docker-desktop",
      status: "warn",
      message: "docker CLI installed but Desktop not running",
    });
  } else {
    results.push({
      name: "docker-desktop",
      status: "ok",
      message: "not installed (Bun-native policy)",
    });
  }

  if (isSyncDaemonRunning()) {
    results.push({
      name: "sync-daemon",
      status: "warn",
      message: "sync-to-desktop daemon is running",
    });
  } else {
    results.push({ name: "sync-daemon", status: "ok", message: "not running" });
  }

  const orphans = countOrphanCandidates(); // from proc-cache.ts
  if (orphans > 0) {
    results.push({
      name: "orphan-processes",
      status: "warn",
      message: `${orphans} candidate(s) — run kimi-orphan-kill`,
    });
  } else {
    results.push({ name: "orphan-processes", status: "ok", message: "none detected" });
  }

  return results;
}

export function printMemoryBudget(logger?: Logger): void {
  const log = logger ?? createLogger(Bun.argv, "kimi-doctor");
  log.section("Memory Budget");
  const groups = getAppRssGroups();
  let total = 0;
  for (const g of groups) {
    log.line(`  ${g.label.padEnd(18)} ${String(g.mb).padStart(5)} MB  (${g.processes} procs)`);
    total += g.mb;
  }
  log.line(`  ${"─".repeat(40)}`);
  log.line(`  ${"Tracked subtotal".padEnd(18)} ${String(total).padStart(5)} MB`);
}
