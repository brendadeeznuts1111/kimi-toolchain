/**
 * boundary.ts — Shared unknown→typed narrowing at I/O boundaries.
 *
 * Use with Bun.file().json()/parseJsonValue (JSON) and parseTomlValue/safeToml (TOML).
 * No schema library — type guards only.
 */

/** Plain object (not null, not array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Safe field read on unknown values. */
export function recordField(obj: unknown, key: string): unknown {
  return isPlainObject(obj) ? obj[key] : undefined;
}

/** Narrow unknown to a plain object or return null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** Optional string record field (undefined allowed). */
export function isOptionalStringRecord(value: unknown): boolean {
  return value === undefined || isStringRecord(value);
}
