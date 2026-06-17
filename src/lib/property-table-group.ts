/**
 * Split property tables by column value (--group-by).
 */

import { join } from "path";
import { emptyToEmDash, formatMarkdownPropertyTable } from "./markdown-table.ts";
import type { MarkdownTableColumnSpec } from "./markdown-table.ts";
import type { PropertyTableRenderPayload } from "./property-table-renderer.ts";

export interface GroupedPropertyTablePayload extends PropertyTableRenderPayload {
  groupKey: string;
}

const TRANSPOSE_FIELD_COLUMN = "Field";

function rowLabelForTranspose(
  row: Record<string, string>,
  index: number,
  columns: readonly string[]
): string {
  for (const candidate of ["name", "Property", "Host", "FromWorkspace"]) {
    if (!columns.includes(candidate)) continue;
    const value = row[candidate]?.trim();
    if (value && value !== emptyToEmDash(null)) return value;
  }
  return `row-${index + 1}`;
}

/** Flip columns ↔ rows: each original column becomes a Field row. */
export function transposeTable(
  columns: readonly string[],
  rows: readonly Record<string, string>[]
): { columns: string[]; rows: Record<string, string>[]; columnSpecs?: MarkdownTableColumnSpec[] } {
  if (rows.length === 0) {
    return { columns: [TRANSPOSE_FIELD_COLUMN], rows: [] };
  }
  const labels = rows.map((row, i) => rowLabelForTranspose(row, i, columns));
  const outColumns = [TRANSPOSE_FIELD_COLUMN, ...labels];
  const outRows = columns.map((col) => {
    const row: Record<string, string> = { [TRANSPOSE_FIELD_COLUMN]: col };
    for (let i = 0; i < rows.length; i++) {
      row[labels[i]!] = rows[i]![col] ?? emptyToEmDash(null);
    }
    return row;
  });
  const columnSpecs: MarkdownTableColumnSpec[] = [
    { name: TRANSPOSE_FIELD_COLUMN, kind: "text" },
    ...labels.map((label) => ({ name: label, kind: "text" as const })),
  ];
  return { columns: outColumns, rows: outRows, columnSpecs };
}

/** Filesystem-safe slug for a group key (preserves hostname dots). */
export function slugifyGroupKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed === emptyToEmDash(null)) return "unknown";
  const slug = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

export function groupRowsByColumn(
  rows: readonly Record<string, string>[],
  column: string
): Map<string, Record<string, string>[]> {
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const key = emptyToEmDash(row[column]);
    const bucket = groups.get(key) ?? [];
    bucket.push({ ...row });
    groups.set(key, bucket);
  }
  return groups;
}

export function sortGroupKeys(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function groupedMarkdownPath(outDir: string, tableSlug: string, groupKey: string): string {
  const base = `table-${tableSlug.replace(/\./g, "-")}`;
  return join(outDir, `${base}-${slugifyGroupKey(groupKey)}.md`);
}

export interface BuildGroupedPayloadsInput {
  baseTitle: string;
  sourceLabel: string;
  filePath: string;
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
  groupBy: string;
  transpose?: boolean;
}

/** One render payload per distinct group-by value. */
export function buildGroupedPayloads(
  input: BuildGroupedPayloadsInput
): GroupedPropertyTablePayload[] {
  const groups = groupRowsByColumn(input.rows, input.groupBy);
  const keys = sortGroupKeys(groups.keys());
  return keys.map((groupKey) => {
    let columns = [...input.columns];
    let rows = groups.get(groupKey)!;
    let columnSpecs = input.columnSpecs;
    if (input.transpose) {
      const flipped = transposeTable(columns, rows);
      columns = flipped.columns;
      rows = flipped.rows;
      columnSpecs = flipped.columnSpecs;
    }
    const title = `${input.baseTitle} (${input.groupBy}=${groupKey})`;
    const markdown = formatMarkdownPropertyTable({
      title,
      source: input.filePath,
      columns,
      rows,
      columnSpecs,
    });
    return {
      title,
      sourceLabel: input.sourceLabel,
      markdown,
      rows,
      columns,
      groupKey,
    };
  });
}

/** Join group markdown docs for stdout (--format markdown/raw). */
export function formatGroupedMarkdownStdout(
  payloads: readonly PropertyTableRenderPayload[]
): string {
  if (payloads.length === 0) return "\n";
  return `${payloads.map((p) => p.markdown.trim()).join("\n\n---\n\n")}\n`;
}

export function defaultGroupedOutDir(projectRoot: string, explicit?: string): string {
  return explicit ?? join(projectRoot, "docs", "groups");
}
