/**
 * Config-level metadata columns for TOML table extracts (--add-metadata).
 */

import { resolve } from "path";
import { TOML } from "bun";
import { pathExists } from "./bun-io.ts";
import { emptyToEmDash } from "./markdown-table.ts";

/** Default root scalars when --add-metadata is passed without a field list. */
export const DEFAULT_CONFIG_METADATA_FIELDS = ["schemaVersion", "name", "scope"] as const;

/** Parse `--add-metadata` or `--add-metadata field,field.nested`. */
export function parseAddMetadataFlag(argv: readonly string[]): string[] | undefined {
  const idx = argv.indexOf("--add-metadata");
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (next && !next.startsWith("-")) {
    const fields = next
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    if (fields.length === 0) {
      throw new Error("Invalid --add-metadata (empty field list)");
    }
    return fields;
  }
  return [...DEFAULT_CONFIG_METADATA_FIELDS];
}

/** Column header mirrors the TOML dot-path; prefixes with config. on collision. */
export function metadataColumnName(
  fieldPath: string,
  existingColumns: ReadonlySet<string> = new Set()
): string {
  const base = fieldPath.trim();
  if (!existingColumns.has(base)) return base;
  const prefixed = `config.${base}`;
  if (!existingColumns.has(prefixed)) return prefixed;
  throw new Error(`Column name collision for --add-metadata field: ${fieldPath}`);
}

/** Read a scalar (or nested table leaf scalar) from a parsed TOML document. */
export function resolveTomlScalarPath(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = doc;
  for (const part of parts) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return undefined;
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
    return current;
  }
  return undefined;
}

export function resolveConfigMetadataValues(
  doc: Record<string, unknown>,
  fields: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const raw = resolveTomlScalarPath(doc, field);
    out[field] = raw == null ? emptyToEmDash(null) : String(raw);
  }
  return out;
}

export async function loadTomlDocument(
  projectRoot: string,
  filePath: string
): Promise<Record<string, unknown>> {
  const absoluteFile = resolve(projectRoot, filePath);
  if (!pathExists(absoluteFile)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return TOML.parse(await Bun.file(absoluteFile).text()) as Record<string, unknown>;
}

export interface ApplyConfigMetadataInput {
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  parsedToml: Record<string, unknown>;
  fields: readonly string[];
  /** Row/table metadata column names (SourceFile, LastModified). */
  tableMetadataColumns?: readonly string[];
}

/** Inject config-level fields as repeated columns on every row (before SourceFile). */
export function applyConfigMetadata(input: ApplyConfigMetadataInput): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const tableMeta = new Set(input.tableMetadataColumns ?? []);
  const values = resolveConfigMetadataValues(input.parsedToml, input.fields);
  const dataCols = input.columns.filter((col) => !tableMeta.has(col));
  const dataColSet = new Set(dataCols);
  const fieldColumns = input.fields.map((field) => metadataColumnName(field, dataColSet));
  const trailingMeta = input.columns.filter((col) => tableMeta.has(col));
  const columns = [...dataCols, ...fieldColumns, ...trailingMeta];

  const rows = input.rows.map((row) => {
    const next = { ...row };
    for (let i = 0; i < input.fields.length; i++) {
      const field = input.fields[i]!;
      const col = fieldColumns[i]!;
      next[col] = values[field] ?? emptyToEmDash(null);
    }
    return next;
  });

  return { columns, rows };
}
