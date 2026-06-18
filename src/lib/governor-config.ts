/**
 * Load resource governor defaults from ~/.kimi-code/governor/defaults.toml
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { getFreeMemoryMB } from "./memory-budget.ts";
import { governorDir } from "./paths.ts";

export interface GovernorDefaults {
  maxMemoryMB: number;
  maxCpuTimeMs: number;
  maxFileSizeMB: number;
  maxOpenFiles: number;
  maxParallelJobs: number;
  diskQuotaMB: number;
  cacheTTLSeconds: number;
  wallClockMs: number;
}

/** Bun 1.4+ cgroup-aware parallelism — not yet in @types/bun 1.3.14. */
export function bunAvailableParallelism(): number | undefined {
  const fn = (Bun as { availableParallelism?: () => number }).availableParallelism;
  if (typeof fn !== "function") return undefined;
  const value = fn();
  return value > 0 ? value : undefined;
}

/** Cgroup-aware CPU parallelism (Bun 1.4+), else hardware concurrency. */
export function resolveHardwareParallelism(): number {
  const cgroupAware = bunAvailableParallelism();
  if (cgroupAware !== undefined) return cgroupAware;
  return navigator.hardwareConcurrency || 4;
}

const BUILTIN: GovernorDefaults = {
  maxMemoryMB: 512,
  maxCpuTimeMs: 30000,
  maxFileSizeMB: 100,
  maxOpenFiles: 256,
  maxParallelJobs: Math.max(2, Math.floor(resolveHardwareParallelism() * 0.75)),
  diskQuotaMB: 1024,
  cacheTTLSeconds: 300,
  wallClockMs: 300000,
};

const CONFIG_PATH = join(governorDir(), "defaults.toml");

export const DEFAULT_CONFIG_TEMPLATE = `# kimi-resource-governor defaults
# Reloaded on each governor invocation.

maxMemoryMB = 512
maxCpuTimeMs = 30000
maxFileSizeMB = 100
maxOpenFiles = 256
maxParallelJobs = 2
diskQuotaMB = 1024
cacheTTLSeconds = 300
wallClockMs = 300000
`;

function parseGovernorToml(text: string): Partial<GovernorDefaults> {
  const out: Partial<GovernorDefaults> = {};
  try {
    const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
    const keys = [
      "maxMemoryMB",
      "maxCpuTimeMs",
      "maxFileSizeMB",
      "maxOpenFiles",
      "maxParallelJobs",
      "diskQuotaMB",
      "cacheTTLSeconds",
      "wallClockMs",
    ] as const;
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = Math.trunc(value);
      }
    }
  } catch {
    /* use builtin */
  }
  return out;
}

export async function loadGovernorDefaults(): Promise<GovernorDefaults> {
  let merged: GovernorDefaults = { ...BUILTIN };

  if (pathExists(CONFIG_PATH)) {
    try {
      const text = await Bun.file(CONFIG_PATH).text();
      merged = { ...merged, ...parseGovernorToml(text) };
    } catch {
      /* use previous */
    }
  }

  // 3. Runtime detection (memory-based parallel cap)
  try {
    const freeMB = await getFreeMemoryMB();
    if (freeMB < 2048) {
      merged.maxParallelJobs = Math.min(merged.maxParallelJobs, 2);
    }
  } catch {
    /* ignore */
  }

  return merged;
}

export function getGovernorConfigPath(): string {
  return CONFIG_PATH;
}

export { BUILTIN as BUILTIN_DEFAULTS };
