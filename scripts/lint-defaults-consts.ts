#!/usr/bin/env bun
/**
 * lint-defaults-consts.ts — Verify dx.config.toml [defaults] values match DEFAULT_* consts in source.
 *
 * Each field in [defaults] must equal the corresponding source constant.
 * Mismatches mean dx table is showing stale / wrong values.
 *
 * @see dx.config.toml [defaults], [version]
 */

import { join } from "node:path";
import { readText } from "../src/lib/bun-io.ts";

const ROOT = join(import.meta.dir, "..");

// ── Field → source mapping ────────────────────────────────────────────

interface DefaultFieldMapping {
  /** [defaults] key in dx.config.toml */
  tomlKey: string;
  /** Source file relative to repo root */
  file: string;
  /** Regex that captures the const value (group 1 = value string) */
  valuePattern: RegExp;
  /** Human-readable const name for error messages */
  constName: string;
}

const MAPPINGS: DefaultFieldMapping[] = [
  // tool-runner.ts
  {
    tomlKey: "toolTimeoutMs",
    file: "src/lib/tool-runner.ts",
    valuePattern: /const DEFAULT_TOOL_TIMEOUT_MS = (\d[\d_]*)/,
    constName: "DEFAULT_TOOL_TIMEOUT_MS",
  },
  {
    tomlKey: "agentToolTimeoutMs",
    file: "src/lib/tool-runner.ts",
    valuePattern: /const AGENT_TOOL_TIMEOUT_MS = (\d[\d_]*)/,
    constName: "AGENT_TOOL_TIMEOUT_MS",
  },
  {
    tomlKey: "toolGracePeriodMs",
    file: "src/lib/tool-runner.ts",
    valuePattern: /const DEFAULT_GRACE_PERIOD_MS = (\d[\d_]*)/,
    constName: "DEFAULT_GRACE_PERIOD_MS",
  },
  {
    tomlKey: "toolMaxOutputBytes",
    file: "src/lib/tool-runner.ts",
    valuePattern: /const DEFAULT_MAX_OUTPUT_BYTES = (\d[\d_]*)/,
    constName: "DEFAULT_MAX_OUTPUT_BYTES",
  },

  // proc-cache.ts
  {
    tomlKey: "processCacheTtlMs",
    file: "src/lib/proc-cache.ts",
    valuePattern: /const CACHE_TTL_MS = (\d[\d_]*)/,
    constName: "CACHE_TTL_MS",
  },

  // governor-config.ts BUILTIN_DEFAULTS
  {
    tomlKey: "governorMaxMemoryMB",
    file: "src/lib/governor-config.ts",
    valuePattern: /maxMemoryMB:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.maxMemoryMB",
  },
  {
    tomlKey: "governorMaxCpuTimeMs",
    file: "src/lib/governor-config.ts",
    valuePattern: /maxCpuTimeMs:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.maxCpuTimeMs",
  },
  {
    tomlKey: "governorMaxFileSizeMB",
    file: "src/lib/governor-config.ts",
    valuePattern: /maxFileSizeMB:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.maxFileSizeMB",
  },
  {
    tomlKey: "governorMaxOpenFiles",
    file: "src/lib/governor-config.ts",
    valuePattern: /maxOpenFiles:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.maxOpenFiles",
  },
  {
    tomlKey: "governorDiskQuotaMB",
    file: "src/lib/governor-config.ts",
    valuePattern: /diskQuotaMB:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.diskQuotaMB",
  },
  {
    tomlKey: "governorCacheTTLSeconds",
    file: "src/lib/governor-config.ts",
    valuePattern: /cacheTTLSeconds:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.cacheTTLSeconds",
  },
  {
    tomlKey: "governorWallClockMs",
    file: "src/lib/governor-config.ts",
    valuePattern: /wallClockMs:\s*(\d+)/,
    constName: "BUILTIN_DEFAULTS.wallClockMs",
  },
  // maxParallelJobs is runtime-computed (hardware * 0.75 or memory-capped to 2)
  // so we skip it — the [defaults] value of 2 is the floor, not the const.

  // cloudflare-access-policy.ts
  {
    tomlKey: "cloudflareTimeoutMs",
    file: "src/lib/cloudflare-access-policy.ts",
    valuePattern: /const DEFAULT_TIMEOUT_MS = (\d[\d_]*)/,
    constName: "DEFAULT_TIMEOUT_MS (cloudflare)",
  },
  {
    tomlKey: "cloudflareRetries",
    file: "src/lib/cloudflare-access-policy.ts",
    valuePattern: /const DEFAULT_RETRIES = (\d+)/,
    constName: "DEFAULT_RETRIES",
  },
  {
    tomlKey: "cloudflareBaseDelayMs",
    file: "src/lib/cloudflare-access-policy.ts",
    valuePattern: /const DEFAULT_BASE_DELAY_MS = (\d[\d_]*)/,
    constName: "DEFAULT_BASE_DELAY_MS",
  },

  // cloudflare-access.ts
  {
    tomlKey: "cloudflareTokenWarnDays",
    file: "src/lib/cloudflare-access.ts",
    valuePattern: /const DEFAULT_WARN_DAYS = (\d+)/,
    constName: "DEFAULT_WARN_DAYS",
  },

  // context-bloat-lint.ts
  {
    tomlKey: "agentsMaxLines",
    file: "src/lib/context-bloat-lint.ts",
    valuePattern: /const AGENTS_MAX_LINES = (\d+)/,
    constName: "AGENTS_MAX_LINES",
  },
  {
    tomlKey: "contextMaxLines",
    file: "src/lib/context-bloat-lint.ts",
    valuePattern: /const CONTEXT_MAX_LINES = (\d+)/,
    constName: "CONTEXT_MAX_LINES",
  },

  // herdr-orchestrator-config.ts
  {
    tomlKey: "dashboardStaleMs",
    file: "src/lib/herdr-orchestrator-config.ts",
    valuePattern: /const DEFAULT_DASHBOARD_STALE_MS = (\d[\d_]*)/,
    constName: "DEFAULT_DASHBOARD_STALE_MS",
  },
  {
    tomlKey: "discoveryCacheTtlMs",
    file: "src/lib/herdr-orchestrator-config.ts",
    valuePattern: /const DEFAULT_DASHBOARD_SSE_POLL_MS = (\d[\d_]*)/,
    constName: "DEFAULT_DASHBOARD_SSE_POLL_MS",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function parseNumericLiteral(raw: string): number {
  return Number(raw.replace(/_/g, ""));
}

function extractConstValue(sourceText: string, pattern: RegExp): number | null {
  const match = sourceText.match(pattern);
  if (!match || match[1] === undefined) return null;
  return parseNumericLiteral(match[1]);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let failures = 0;

  // Load dx.config.toml [defaults]
  const configPath = join(ROOT, "dx.config.toml");
  let defaultsToml: Record<string, unknown> = {};
  try {
    const configText = await readText(configPath);
    const parsed = Bun.TOML.parse(configText) as Record<string, unknown>;
    defaultsToml = (parsed.defaults as Record<string, unknown>) ?? {};
  } catch (err) {
    console.error(`dx.config.toml: parse error — ${err}`);
    process.exit(2);
  }

  // Load each source file on demand (cache by path)
  const sourceCache = new Map<string, string>();
  async function loadSource(file: string): Promise<string> {
    const cached = sourceCache.get(file);
    if (cached !== undefined) return cached;
    const text = await readText(join(ROOT, file));
    sourceCache.set(file, text);
    return text;
  }

  for (const mapping of MAPPINGS) {
    const tomlValue = defaultsToml[mapping.tomlKey];
    if (tomlValue === undefined) {
      console.error(
        `dx.config.toml [defaults]: missing key ${mapping.tomlKey} (expected from ${mapping.constName} in ${mapping.file})`
      );
      failures++;
      continue;
    }
    if (typeof tomlValue !== "number") {
      console.error(
        `dx.config.toml [defaults]: ${mapping.tomlKey} is not a number (got ${typeof tomlValue})`
      );
      failures++;
      continue;
    }

    const sourceText = await loadSource(mapping.file);
    const sourceValue = extractConstValue(sourceText, mapping.valuePattern);
    if (sourceValue === null) {
      console.error(
        `dx.config.toml [defaults]: cannot find ${mapping.constName} in ${mapping.file}`
      );
      failures++;
      continue;
    }

    if (tomlValue !== sourceValue) {
      console.error(
        `dx.config.toml [defaults]: ${mapping.tomlKey} = ${tomlValue} but ${mapping.constName} = ${sourceValue} in ${mapping.file}`
      );
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} default-const mismatch(es) found.`);
    console.error("Update dx.config.toml [defaults] to match source constants (or vice versa).");
    process.exit(1);
  }

  console.log("✓ dx.config.toml [defaults] matches source DEFAULT_* constants");
  process.exit(0);
}

main();
