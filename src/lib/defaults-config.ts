/**
 * defaults-config.ts — Read dx.config.toml [defaults] as typed configuration.
 *
 * Provides the project-level SSOT for operational defaults.  Each consumer
 * (governor, tool-runner, cloudflare, dashboard) reads from here and merges
 * its own runtime overrides on top.
 *
 * Cached per-project-root for the process lifetime — call invalidateDefaultsCache()
 * in tests or when dx.config.toml changes at runtime.
 */

import { pathExists, readText } from "./bun-io.ts";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────

export interface DefaultsConfig {
  // tool-runner.ts
  toolTimeoutMs: number;
  agentToolTimeoutMs: number;
  toolGracePeriodMs: number;
  toolMaxOutputBytes: number;

  // proc-cache.ts
  processCacheTtlMs: number;

  // governor-config.ts BUILTIN_DEFAULTS
  governorMaxMemoryMB: number;
  governorMaxCpuTimeMs: number;
  governorMaxParallelJobs: number;
  governorCacheTTLSeconds: number;
  governorWallClockMs: number;
  governorMaxFileSizeMB: number;
  governorMaxOpenFiles: number;
  governorDiskQuotaMB: number;

  // cloudflare-access.ts / cloudflare-access-policy.ts
  cloudflareTimeoutMs: number;
  cloudflareRetries: number;
  cloudflareBaseDelayMs: number;
  cloudflareTokenWarnDays: number;

  // context-bloat-lint.ts
  agentsMaxLines: number;
  contextMaxLines: number;

  // herdr-orchestrator-config.ts
  discoveryCacheTtlMs: number;
  dashboardStaleMs: number;
}

const DEFAULTS_CONFIG_KEYS: (keyof DefaultsConfig)[] = [
  "toolTimeoutMs",
  "agentToolTimeoutMs",
  "toolGracePeriodMs",
  "toolMaxOutputBytes",
  "processCacheTtlMs",
  "governorMaxMemoryMB",
  "governorMaxCpuTimeMs",
  "governorMaxParallelJobs",
  "governorCacheTTLSeconds",
  "governorWallClockMs",
  "governorMaxFileSizeMB",
  "governorMaxOpenFiles",
  "governorDiskQuotaMB",
  "cloudflareTimeoutMs",
  "cloudflareRetries",
  "cloudflareBaseDelayMs",
  "cloudflareTokenWarnDays",
  "agentsMaxLines",
  "contextMaxLines",
  "discoveryCacheTtlMs",
  "dashboardStaleMs",
];

// ── Cache ──────────────────────────────────────────────────────────────

const cache = new Map<string, DefaultsConfig | null>();

export function invalidateDefaultsCache(projectRoot?: string): void {
  if (projectRoot) {
    cache.delete(projectRoot);
  } else {
    cache.clear();
  }
}

// ── Load ───────────────────────────────────────────────────────────────

function coerceNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const num = Number(raw.replace(/_/g, ""));
    if (Number.isFinite(num)) return Math.trunc(num);
  }
  return undefined;
}

/**
 * Read dx.config.toml and extract the [defaults] table.
 * Returns null if the file is missing, unreadable, or [defaults] is absent.
 */
export async function loadDxDefaults(projectRoot: string): Promise<DefaultsConfig | null> {
  const cached = cache.get(projectRoot);
  if (cached !== undefined) return cached;

  const configPath = join(projectRoot, "dx.config.toml");
  if (!pathExists(configPath)) {
    cache.set(projectRoot, null);
    return null;
  }

  const text = await Bun.file(configPath).text();
  const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
  const raw = (parsed.defaults as Record<string, unknown>) ?? {};

  const config: Partial<DefaultsConfig> = {};
  let hasAny = false;
  for (const key of DEFAULTS_CONFIG_KEYS) {
    const value = coerceNumber(raw[key as string]);
    if (value !== undefined) {
      (config as Record<string, number>)[key] = value;
      hasAny = true;
    }
  }

  if (!hasAny) {
    cache.set(projectRoot, null);
    return null;
  }

  const full = config as DefaultsConfig;
  cache.set(projectRoot, full);
  return full;
}

/**
 * Synchronous variant — use when already inside a sync context or when
 * the file is known to be small and fast to parse.
 */
export function loadDxDefaultsSync(projectRoot: string): DefaultsConfig | null {
  const cached = cache.get(projectRoot);
  if (cached !== undefined) return cached;

  const configPath = join(projectRoot, "dx.config.toml");
  if (!pathExists(configPath)) {
    cache.set(projectRoot, null);
    return null;
  }

  const text = readText(configPath);
  const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
  const raw = (parsed.defaults as Record<string, unknown>) ?? {};

  const config: Partial<DefaultsConfig> = {};
  let hasAny = false;
  for (const key of DEFAULTS_CONFIG_KEYS) {
    const value = coerceNumber(raw[key as string]);
    if (value !== undefined) {
      (config as Record<string, number>)[key] = value;
      hasAny = true;
    }
  }

  if (!hasAny) {
    cache.set(projectRoot, null);
    return null;
  }

  const full = config as DefaultsConfig;
  cache.set(projectRoot, full);
  return full;
}

/**
 * Merge dx.config.toml [defaults] into a partial config, with source defaults
 * as fallback.  Returns the merged config and a boolean indicating whether
 * dx.config.toml contributed any values.
 */
export function mergeDefaults(
  source: Partial<DefaultsConfig>,
  dx: DefaultsConfig | null
): { config: Partial<DefaultsConfig>; fromDx: boolean } {
  if (!dx) return { config: { ...source }, fromDx: false };

  const merged: Partial<DefaultsConfig> = { ...source };
  let fromDx = false;
  for (const key of DEFAULTS_CONFIG_KEYS) {
    if (merged[key] === undefined && dx[key] !== undefined) {
      (merged as Record<string, number>)[key] = dx[key];
      fromDx = true;
    }
  }
  return { config: merged, fromDx };
}
