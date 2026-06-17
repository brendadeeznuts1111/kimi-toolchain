/**
 * Markdown table formatting with column alignment hints from data kinds.
 */

import { readableStreamToText as streamToText } from "./bun-utils.ts";

export type MarkdownColumnKind = "text" | "number" | "date" | "path";
export type MarkdownColumnAlign = "left" | "right" | "center";

export interface MarkdownTableColumnSpec {
  name: string;
  kind?: MarkdownColumnKind;
  align?: MarkdownColumnAlign;
}

const EMPTY_CELL = "—";

/** Unified empty-cell placeholder: trim whitespace; null/undefined/blank → em dash. */
export function emptyToEmDash(value: unknown): string {
  if (value == null) return EMPTY_CELL;
  if (Array.isArray(value)) {
    return value.length === 0 ? EMPTY_CELL : emptyToEmDash(value.join(", "));
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : EMPTY_CELL;
}

export const TABLE_METADATA_COLUMNS = ["LastModified", "SourceFile"] as const;

export const SOURCE_FILE_COLUMN_SPEC: MarkdownTableColumnSpec = {
  name: "SourceFile",
  kind: "path",
};

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function defaultAlignForKind(kind: MarkdownColumnKind | undefined): MarkdownColumnAlign {
  if (kind === "number" || kind === "date") return "right";
  return "left";
}

function alignmentToken(align: MarkdownColumnAlign): string {
  if (align === "right") return "---:";
  if (align === "center") return ":---:";
  return ":---";
}

/** Infer column kind from non-empty cell values when no spec is provided. */
export function inferMarkdownColumnKind(
  column: string,
  rows: readonly Record<string, string>[]
): MarkdownColumnKind {
  const values = rows
    .map((row) => row[column] ?? "")
    .filter((value) => value !== "" && value !== EMPTY_CELL);
  if (values.length === 0) return "text";

  if (values.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return "date";
  if (values.every((value) => /^\d+$/.test(value))) return "number";
  if (values.every((value) => value.includes("/") || value.startsWith("~"))) return "path";

  return "text";
}

export function resolveMarkdownColumnSpecs(
  columns: readonly string[],
  rows: readonly Record<string, string>[],
  specs?: readonly MarkdownTableColumnSpec[]
): MarkdownTableColumnSpec[] {
  const byName = new Map((specs ?? []).map((spec) => [spec.name, spec]));
  return columns.map((name) => {
    const spec = byName.get(name);
    const kind = spec?.kind ?? inferMarkdownColumnKind(name, rows);
    return {
      name,
      kind,
      align: spec?.align ?? defaultAlignForKind(kind),
    };
  });
}

export interface FormatMarkdownTableOptions {
  title: string;
  source?: string;
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
}

/** Build a property-table style Markdown document with aligned GFM table separators. */
export function formatMarkdownPropertyTable(options: FormatMarkdownTableOptions): string {
  const resolved = resolveMarkdownColumnSpecs(options.columns, options.rows, options.columnSpecs);
  const header = `| ${resolved.map((col) => col.name).join(" | ")} |`;
  const sep = `| ${resolved.map((col) => alignmentToken(col.align!)).join(" | ")} |`;
  const body = options.rows
    .map(
      (row) =>
        `| ${resolved.map((col) => escapeMarkdownCell(emptyToEmDash(row[col.name]))).join(" | ")} |`
    )
    .join("\n");

  const lines = [`# ${options.title}`, ""];
  if (options.source) lines.push(`Source: \`${options.source}\``, "");
  lines.push(header, sep, body, "");
  return lines.join("\n");
}

export interface BunMarkdownPreviewResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Render a Markdown file with `bun ./file.md` (Bun v1.3.12+ terminal renderer). */
export async function previewMarkdownWithBun(mdPath: string): Promise<BunMarkdownPreviewResult> {
  const proc = Bun.spawn(["bun", mdPath], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      NO_COLOR: "1",
      TERM: Bun.env.TERM ?? "dumb",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    streamToText(proc.stdout!),
    streamToText(proc.stderr!),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
