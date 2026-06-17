/**
 * Pure DX config merge — no Effect, no domain semantics.
 *
 * Policy:
 * - Scalars: project overrides global
 * - Objects: deep merge
 * - Primitive arrays: project replaces global when non-empty
 * - Array-of-tables (object arrays): union (global first, then project)
 */

export type DxConfigDocument = Record<string, unknown>;

function isPlainObject(value: unknown): value is DxConfigDocument {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isArrayOfTables(value: unknown): value is DxConfigDocument[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

/** Merge project document over global defaults. */
export function mergeDxConfigDocuments(
  globalDoc: DxConfigDocument,
  projectDoc: DxConfigDocument
): DxConfigDocument {
  return mergeValue(globalDoc, projectDoc) as DxConfigDocument;
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (base === undefined) return override;

  if (Array.isArray(base) && Array.isArray(override)) {
    if (override.length === 0) return base;
    if (base.length === 0) return override;
    if (isArrayOfTables(base) && isArrayOfTables(override)) {
      return [...base, ...override];
    }
    return override;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    const out: DxConfigDocument = {};
    for (const key of keys) {
      out[key] = mergeValue(base[key], override[key]);
    }
    return out;
  }

  return override;
}
