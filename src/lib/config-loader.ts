/**
 * config-loader.ts — Unified config file loader with format detection.
 *
 * Delegates to Bun's native parsers: TOML (bunfig.toml / dx.config.toml),
 * JSONC (.jsonc / comment-bearing JSON), JSON5 (.json5 files), and JSON (.json).
 *
 * @see https://bun.com/docs/runtime/jsonc
 * @see https://bun.com/docs/runtime/json5
 */

import { safeToml, safeParse, safeJsonc, jsoncSupported } from "./utils.ts";

export type ConfigFormat = "toml" | "json" | "json5" | "jsonc";

/** Detect config format from file extension. */
export function detectConfigFormat(path: string): ConfigFormat {
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".jsonc")) return "jsonc";
  if (path.endsWith(".json5")) return "json5";
  return "json";
}

/**
 * Load and parse a config file. Delegates to the appropriate parser
 * based on file extension.
 */
export function loadConfig<T = unknown>(text: string, format: ConfigFormat, fallback: T): T {
  switch (format) {
    case "toml":
      return safeToml<T>(text, fallback);
    case "jsonc":
      return safeJsonc<T>(text, fallback);
    case "json5": {
      const parsed = json5Parse(text);
      return parsed !== null ? (parsed as T) : safeJsonc<T>(text, fallback);
    }
    case "json":
    default:
      return safeParse<T>(text, fallback);
  }
}

function json5Parse(text: string): unknown {
  const json5 = (Bun as { JSON5?: { parse: (s: string) => unknown } }).JSON5;
  return typeof json5?.parse === "function" ? json5.parse(text) : null;
}

/** True when Bun.JSON5 is available (Bun >= 1.3.7). */
export function json5Supported(): boolean {
  const json5 = (Bun as { JSON5?: { parse: (s: string) => unknown } }).JSON5;
  return typeof json5?.parse === "function";
}

export { jsoncSupported };
