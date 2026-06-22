/**
 * Safe parsing helpers — JSON and TOML with fallbacks and optional validators.
 *
 * Kept in a dedicated module so heavy consumers (e.g. tool-runner -> bun-utils)
 * can import parsing utilities without creating circular dependencies through
 * the rest of utils.ts.
 */

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
