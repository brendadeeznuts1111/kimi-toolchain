/**
 * config-loader.ts — Unified config file loader with format detection.
 *
 * Delegates to Bun's native parsers: TOML (bunfig.toml / dx.config.toml),
 * JSON5 (.json5 files), and JSON (.json files).
 *
 * Currently only the JSON5 path is parked — no .json5 configs exist in the
 * toolchain today. The facade is ready when a third-party integration or
 * design-tokens pipeline ships a .json5 file.
 *
 * B3.1 — parked.
 * @see https://bun.sh/docs/runtime/json5
 */

import { safeToml, safeParse } from "./utils.ts";

export type ConfigFormat = "toml" | "json" | "json5";

/** Detect config format from file extension. */
export function detectConfigFormat(path: string): ConfigFormat {
  if (path.endsWith(".toml")) return "toml";
  if (path.endsWith(".json5")) return "json5";
  return "json";
}

/**
 * Load and parse a config file. Delegates to the appropriate parser
 * based on file extension.
 *
 * JSON5 support is parked — Bun.JSON5.parse() is available in Bun >= 1.3.7
 * but no .json5 configs exist yet.
 */
export function loadConfig<T = unknown>(text: string, format: ConfigFormat, fallback: T): T {
  switch (format) {
    case "toml":
      return safeToml<T>(text, fallback);
    case "json5":
      return (Bun as any).JSON5?.parse(text) ?? safeParse<T>(text, fallback);
    case "json":
    default:
      return safeParse<T>(text, fallback);
  }
}

/**
 * True when Bun.JSON5 is available (Bun >= 1.3.7).
 * Use this to gate JSON5-dependent code paths.
 */
export function json5Supported(): boolean {
  return typeof (Bun as any).JSON5?.parse === "function";
}
