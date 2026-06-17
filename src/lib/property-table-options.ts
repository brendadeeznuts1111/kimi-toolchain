/**
 * Post-process options for property-table extract (--exact, --sort-by, metadata columns).
 */

import {
  emptyToEmDash,
  SOURCE_FILE_COLUMN_SPEC,
  TABLE_METADATA_COLUMNS,
  type MarkdownTableColumnSpec,
} from "./markdown-table.ts";
import { applyConfigMetadata, parseAddMetadataFlag } from "./property-table-metadata.ts";
import { applyUrlDecomposition } from "./url-decomposer.ts";

export interface TableRowFilter {
  column: string;
  value: string;
}

export interface TableExtractFlags {
  exact: boolean;
  preview: boolean;
  decomposeUrls: boolean;
  noSourceUrl: boolean;
  noHeader: boolean;
  /** Subset from --columns col1,col2,... */
  columnPick?: string[];
  /** Row filters from --filter col=value (ANDed). */
  filters: TableRowFilter[];
  /** Column from --group-by COL (split output per value). */
  groupBy?: string;
  /** Flip columns ↔ rows (Field column + one column per source row). */
  transpose: boolean;
  /** Emit key-indexed catalog sections (--describe). */
  describe: boolean;
  /** Key column from --keys COL (required with --describe). */
  describeKeys?: string;
  /** Explicit column name, or undefined when --sort-by omitted. */
  sortBy?: string;
  /** True when `--sort-by` is present without a following column name. */
  sortByDefault: boolean;
  /** Path from --schema <file> (TOML or JSON row/column contract). */
  schemaPath?: string;
  /** When true, schema violations are stderr warnings only (--schema-warn). */
  schemaWarn: boolean;
  /** Config-level TOML fields from --add-metadata (undefined when flag omitted). */
  addMetadata?: string[];
}

/** Parse `--filter Host=staging` into column + value. */
export function parseTableFilterArg(raw: string): TableRowFilter {
  const idx = raw.indexOf("=");
  if (idx <= 0) {
    throw new Error(`Invalid --filter (expected col=value): ${raw}`);
  }
  const column = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1);
  if (!column) throw new Error(`Invalid --filter (missing column): ${raw}`);
  return { column, value };
}

/** Parse `--columns Host,Port,url_pathname`. */
export function parseTableColumnsArg(raw: string): string[] {
  const columns = raw
    .split(",")
    .map((col) => col.trim())
    .filter(Boolean);
  if (columns.length === 0) {
    throw new Error("Invalid --columns (empty list)");
  }
  return columns;
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

export function parseTableExtractFlags(argv: readonly string[]): TableExtractFlags {
  const exact = argv.includes("--exact");
  const preview = argv.includes("--preview");
  const decomposeUrls = argv.includes("--decompose-urls") || argv.includes("-u");
  const noSourceUrl = argv.includes("--no-source-url") || argv.includes("--hide-source-url");
  const noHeader = argv.includes("--no-header");
  const transpose = argv.includes("--transpose");

  const filters: TableRowFilter[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--filter") {
      const raw = argv[i + 1];
      if (raw && !raw.startsWith("-")) {
        filters.push(parseTableFilterArg(raw));
        i++;
      }
    }
  }

  const columnsRaw = readFlagValue(argv, "--columns");
  const columnPick = columnsRaw ? parseTableColumnsArg(columnsRaw) : undefined;
  const groupBy = readFlagValue(argv, "--group-by");
  const describe = argv.includes("--describe");
  const describeKeys = readFlagValue(argv, "--keys");
  const schemaPath = readFlagValue(argv, "--schema");
  const schemaWarn = argv.includes("--schema-warn");
  const addMetadata = parseAddMetadataFlag(argv);

  const idx = argv.indexOf("--sort-by");
  const base = {
    exact,
    preview,
    decomposeUrls,
    noSourceUrl,
    noHeader,
    columnPick,
    filters,
    groupBy,
    transpose,
    describe,
    describeKeys,
    schemaPath,
    schemaWarn,
    addMetadata,
  };
  if (idx === -1) {
    return { ...base, sortBy: undefined, sortByDefault: false };
  }
  const next = argv[idx + 1];
  if (next && !next.startsWith("-")) {
    return { ...base, sortBy: next, sortByDefault: false };
  }
  return { ...base, sortBy: undefined, sortByDefault: true };
}

export interface ApplyTableRenderOptionsInput {
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  filePath: string;
  exact?: boolean;
  sortBy?: string;
  sortByDefault?: boolean;
  decomposeUrls?: boolean;
  noSourceUrl?: boolean;
  noHeader?: boolean;
  columnPick?: readonly string[];
  filters?: readonly TableRowFilter[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
  /** Config-level TOML fields (--add-metadata); skipped when exact is true. */
  addMetadataFields?: readonly string[];
  parsedToml?: Record<string, unknown>;
}

export interface ApplyTableRenderOptionsResult {
  columns: string[];
  rows: Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
}

const metadataSet = new Set<string>(TABLE_METADATA_COLUMNS);

function normalizeRows(rows: readonly Record<string, string>[]): Record<string, string>[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, emptyToEmDash(value)]))
  );
}

function firstDataColumn(columns: readonly string[]): string | undefined {
  return columns.find((col) => !metadataSet.has(col));
}

/** Trim cells, add/remove metadata columns, optional sort. */
export function applyTableRenderOptions(
  input: ApplyTableRenderOptionsInput
): ApplyTableRenderOptionsResult {
  let columns = [...input.columns];
  let rows = normalizeRows(input.rows);
  let columnSpecs = input.columnSpecs;

  if (input.decomposeUrls) {
    const decomposed = applyUrlDecomposition({
      columns,
      rows,
      columnSpecs,
      noSourceUrl: input.noSourceUrl,
    });
    columns = decomposed.columns;
    rows = decomposed.rows;
    columnSpecs = decomposed.columnSpecs;
  }

  if (
    !input.exact &&
    input.addMetadataFields &&
    input.addMetadataFields.length > 0 &&
    input.parsedToml
  ) {
    const enriched = applyConfigMetadata({
      columns,
      rows,
      parsedToml: input.parsedToml,
      fields: input.addMetadataFields,
      tableMetadataColumns: TABLE_METADATA_COLUMNS,
    });
    columns = enriched.columns;
    rows = enriched.rows;
  }

  if (!input.exact) {
    if (!columns.includes("SourceFile")) {
      columns.push("SourceFile");
    }
    rows = rows.map((row) => ({ ...row, SourceFile: input.filePath }));
  } else {
    columns = columns.filter((col) => !metadataSet.has(col));
    rows = rows.map((row) => {
      const next = { ...row };
      for (const col of TABLE_METADATA_COLUMNS) {
        delete next[col];
      }
      return next;
    });
  }

  const sortColumn = input.sortBy ?? (input.sortByDefault ? firstDataColumn(columns) : undefined);
  if (sortColumn && columns.includes(sortColumn)) {
    rows = [...rows].sort((a, b) =>
      (a[sortColumn] ?? "").localeCompare(b[sortColumn] ?? "", undefined, {
        sensitivity: "base",
      })
    );
  }

  if (input.filters && input.filters.length > 0) {
    for (const filter of input.filters) {
      if (!columns.includes(filter.column)) {
        throw new Error(`Unknown --filter column: ${filter.column}`);
      }
    }
    rows = rows.filter((row) =>
      input.filters!.every((filter) => (row[filter.column] ?? "") === filter.value)
    );
  }

  if (input.columnPick && input.columnPick.length > 0) {
    const available = new Set(columns);
    const unknown = input.columnPick.filter((col) => !available.has(col));
    if (unknown.length > 0) {
      throw new Error(`Unknown --columns: ${unknown.join(", ")}`);
    }
    columns = [...input.columnPick];
    rows = rows.map((row) =>
      Object.fromEntries(columns.map((col) => [col, row[col] ?? emptyToEmDash(null)]))
    );
    if (columnSpecs) {
      const allowed = new Set(columns);
      columnSpecs = columnSpecs.filter((spec) => allowed.has(spec.name));
    }
  }

  return { columns, rows, columnSpecs };
}

export function filterColumnSpecsForColumns(
  specs: readonly MarkdownTableColumnSpec[] | undefined,
  columns: readonly string[]
): readonly MarkdownTableColumnSpec[] | undefined {
  if (!specs) return undefined;
  const allowed = new Set(columns);
  const filtered = specs.filter((spec) => allowed.has(spec.name));
  const out = [...filtered];
  if (allowed.has("SourceFile") && !out.some((spec) => spec.name === "SourceFile")) {
    out.push(SOURCE_FILE_COLUMN_SPEC);
  }
  return out;
}
