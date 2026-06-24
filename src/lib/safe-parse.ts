/**
 * Safe parsing helpers — JSON and TOML with fallbacks and optional validators.
 *
 * Kept in a dedicated module so heavy consumers (e.g. tool-runner -> bun-utils)
 * can import parsing utilities without creating circular dependencies through
 * the rest of utils.ts.
 *
 * @see {@link BUN_JSONC_RELEASE_URL} — Bun.JSONC.parse (Bun >= 1.3.6)
 */

import { BUN_JSONC_RELEASE_URL } from "./bun-release-registry.ts";

/** @see {@link BUN_JSONC_RELEASE_URL} */
export { BUN_JSONC_RELEASE_URL };

function _safeParse<T>(
  parse: (input: string) => unknown,
  input: string,
  fallback: T,
  validator?: (v: unknown) => v is T
): T {
  try {
    const parsed: unknown = parse(input);
    if (validator) {
      return validator(parsed) ? parsed : fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Safely parse JSON with a fallback value on failure. */
export function safeParse<T>(json: string, fallback: T): T;
/** Safely parse JSON with a fallback and optional validator. */
export function safeParse<T>(json: string, fallback: T, validator: (v: unknown) => v is T): T;
export function safeParse<T>(json: string, fallback: T, validator?: (v: unknown) => v is T): T {
  return _safeParse(JSON.parse, json, fallback, validator);
}

/** Safely parse TOML with a fallback value on failure. */
export function safeToml<T>(text: string, fallback: T): T;
/** Safely parse TOML with a fallback and optional validator. */
export function safeToml<T>(text: string, fallback: T, validate: (val: unknown) => val is T): T;
export function safeToml<T>(text: string, fallback: T, validate?: (val: unknown) => val is T): T {
  return _safeParse(Bun.TOML.parse, text, fallback, validate);
}

/** Safely parse JSON5 with a fallback value on failure. */
export function safeJson5<T>(text: string, fallback: T): T;
/** Safely parse JSON5 with a fallback and optional validator. */
export function safeJson5<T>(text: string, fallback: T, validate: (val: unknown) => val is T): T;
export function safeJson5<T>(text: string, fallback: T, validate?: (val: unknown) => val is T): T {
  return _safeParse(Bun.JSON5.parse, text, fallback, validate);
}

type JsoncApi = { parse: (input: string) => unknown };

function jsoncApi(): JsoncApi | null {
  const jsonc = (Bun as { JSONC?: JsoncApi }).JSONC;
  return typeof jsonc?.parse === "function" ? jsonc : null;
}

/** True when Bun.JSONC.parse is available (Bun >= 1.3.6). */
export function jsoncSupported(): boolean {
  return jsoncApi() !== null;
}

/** Safely parse JSONC (comments + trailing commas) with a fallback on failure. */
export function safeJsonc<T>(text: string, fallback: T): T;
/** Safely parse JSONC with a fallback and optional validator. */
export function safeJsonc<T>(text: string, fallback: T, validate: (val: unknown) => val is T): T;
export function safeJsonc<T>(text: string, fallback: T, validate?: (val: unknown) => val is T): T {
  const api = jsoncApi();
  if (api) {
    return _safeParse(api.parse.bind(api), text, fallback, validate);
  }
  return validate ? safeParse(text, fallback, validate) : safeParse(text, fallback);
}
