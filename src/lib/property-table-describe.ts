/**
 * Key-indexed property catalogs (--describe --keys COL).
 */

import { join } from "path";
import { emptyToEmDash } from "./markdown-table.ts";
import type { PropertyTableRenderPayload } from "./property-table-renderer.ts";
import { slugifyGroupKey } from "./property-table-group.ts";

export interface FormatDescribeMarkdownInput {
  title: string;
  source?: string;
  keyColumn: string;
  columns: readonly string[];
  rows: readonly Record<string, string>[];
}

function sectionKeyForRow(row: Record<string, string>, keyColumn: string, index: number): string {
  const raw = emptyToEmDash(row[keyColumn]);
  if (raw !== "—") return raw;
  return `row-${index + 1}`;
}

function formatDescribeFieldValue(value: string): string {
  if (value === "—") return value;
  if (/^https?:\/\//.test(value) || value.includes("/") || value.includes(".")) {
    return `\`${value}\``;
  }
  return value;
}

/** Build a catalog document with one ## section per row keyed by --keys column. */
export function formatDescribeMarkdown(input: FormatDescribeMarkdownInput): string {
  const fieldColumns = input.columns.filter((col) => col !== input.keyColumn);
  const lines = [`# ${input.title}`, ""];
  if (input.source) {
    lines.push(`Source: \`${input.source}\``, "");
  }

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i]!;
    lines.push(`## ${sectionKeyForRow(row, input.keyColumn, i)}`, "");
    for (const col of fieldColumns) {
      const value = emptyToEmDash(row[col]);
      lines.push(`- **${col}**: ${formatDescribeFieldValue(value)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function defaultDescribeOutDir(projectRoot: string, explicit?: string): string {
  return explicit ?? join(projectRoot, "docs", "describe");
}

export function describeMarkdownPath(outDir: string, tableSlug: string): string {
  return join(outDir, `table-${tableSlug.replace(/\./g, "-")}.md`);
}

export function describeEntryMarkdownPath(
  outDir: string,
  tableSlug: string,
  entryKey: string
): string {
  const base = `table-${tableSlug.replace(/\./g, "-")}`;
  return join(outDir, `${base}-${slugifyGroupKey(entryKey)}.md`);
}

export interface BuildDescribePayloadsInput {
  baseTitle: string;
  sourceLabel: string;
  filePath: string;
  keyColumn: string;
  columns: readonly string[];
  rows: readonly Record<string, string>[];
}

export interface DescribedPropertyTablePayload extends PropertyTableRenderPayload {
  entryKey: string;
}

/** One render payload per row (keyed section). */
export function buildDescribePayloads(
  input: BuildDescribePayloadsInput
): DescribedPropertyTablePayload[] {
  return input.rows.map((row, index) => {
    const entryKey = sectionKeyForRow(row, input.keyColumn, index);
    const title = `${input.baseTitle} (${input.keyColumn}=${entryKey})`;
    const markdown = formatDescribeMarkdown({
      title,
      source: input.filePath,
      keyColumn: input.keyColumn,
      columns: input.columns,
      rows: [row],
    });
    return {
      title,
      sourceLabel: input.sourceLabel,
      markdown,
      rows: [row],
      columns: input.columns,
      entryKey,
    };
  });
}

/** Join per-entry describe docs for stdout (--format markdown/raw). */
export function formatDescribeMarkdownStdout(
  payloads: readonly PropertyTableRenderPayload[]
): string {
  if (payloads.length === 0) return "\n";
  return `${payloads.map((p) => p.markdown.trim()).join("\n\n---\n\n")}\n`;
}
