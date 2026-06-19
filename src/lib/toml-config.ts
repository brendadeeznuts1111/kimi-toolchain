/**
 * toml-config.ts — Typed TOML config loader with schema validation + defaults.
 *
 * Reads a TOML file, validates against a user-provided schema (type guard),
 * merges defaults, and returns a structured result. No schema library needed —
 * validation is a simple predicate function.
 *
 * @example
 * const schema = (v: unknown): v is { port: number; host: string } =>
 *   typeof v === "object" && v !== null &&
 *   typeof (v as any).port === "number" &&
 *   typeof (v as any).host === "string";
 * const result = await loadTomlConfig("config.toml", schema, { port: 3000, host: "localhost" });
 */

import { pathExists, readText } from "./bun-io.ts";
import { safeToml } from "./utils.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface LoadTomlConfigOk<T> {
  ok: true;
  config: T;
  path: string;
}

export interface LoadTomlConfigErr {
  ok: false;
  error: string;
  code: "not-found" | "parse-error" | "validation-error";
  path: string;
  raw?: string;
}

export type LoadTomlConfigResult<T> = LoadTomlConfigOk<T> | LoadTomlConfigErr;

export type TomlSchema<T> = (value: unknown) => value is T;

// ── Implementation ─────────────────────────────────────────────────

/**
 * Load and validate a TOML config file.
 *
 * @param path     — absolute or relative path to the .toml file
 * @param schema   — type guard function that validates the parsed object
 * @param defaults — fallback config returned when the file is not found
 * @returns        — structured ok/error result with typed config
 */
export async function loadTomlConfig<T>(
  path: string,
  schema: TomlSchema<T>,
  defaults: T
): Promise<LoadTomlConfigResult<T>> {
  // File not found → return defaults
  if (!pathExists(path)) {
    return { ok: true, config: defaults, path };
  }

  const raw = readText(path);

  // Parse TOML
  const parsed = safeToml<unknown>(raw, null);
  if (parsed === null) {
    return {
      ok: false,
      error: `Failed to parse TOML: ${path}`,
      code: "parse-error",
      path,
      raw,
    };
  }

  // Validate against schema
  if (!schema(parsed)) {
    return {
      ok: false,
      error: `Config validation failed for ${path}. Check required fields.`,
      code: "validation-error",
      path,
      raw,
    };
  }

  return { ok: true, config: parsed, path };
}

/**
 * Synchronous version for module-load-time config (bunfig, constants, etc.).
 * Throws on parse/validation errors — use only when failure should be fatal.
 */
export function loadTomlConfigSync<T>(path: string, schema: TomlSchema<T>, defaults: T): T {
  if (!pathExists(path)) return defaults;

  const raw = readText(path);
  const parsed = safeToml<unknown>(raw, null);
  if (parsed === null) {
    throw new Error(`Failed to parse TOML: ${path}`);
  }
  if (!schema(parsed)) {
    throw new Error(`Config validation failed for ${path}`);
  }
  return parsed;
}

// ── Built-in schemas ───────────────────────────────────────────────

/** Schema for a simple key-value config (e.g., bunfig [run] section). */
export function recordSchema<T = string>(): TomlSchema<Record<string, T>> {
  return (v: unknown): v is Record<string, T> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Schema for a config with required string fields. */
export function stringFieldsSchema<K extends string>(
  ...fields: K[]
): TomlSchema<Record<K, string>> {
  return (v: unknown): v is Record<K, string> =>
    typeof v === "object" && v !== null && fields.every((f) => typeof (v as any)[f] === "string");
}
