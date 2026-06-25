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

const BUILTIN: GovernorDefaults = {
  maxMemoryMB: 512,
  maxCpuTimeMs: 30000,
  maxFileSizeMB: 100,
  maxOpenFiles: 256,
  maxParallelJobs: Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)),
  diskQuotaMB: 1024,
  cacheTTLSeconds: 300,
  wallClockMs: 300000,
};

export function resolveHardwareParallelism(): number {
  const bun = Bun as typeof Bun & { availableParallelism?: () => number };
  if (typeof bun.availableParallelism === "function") {
    const value = bun.availableParallelism();
    if (value > 0) return value;
  }
  const concurrency = navigator.hardwareConcurrency || 4;
  return concurrency > 0 ? concurrency : 4;
}

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
    const text = await Bun.file(CONFIG_PATH).text();
    merged = { ...merged, ...parseGovernorToml(text) };
  }

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
