/**
 * Property table output — raw Markdown files (default) + optional inspect.
 *
 * Post Bun v1.3.12: preview with `bun ./path/to/table.md` (native renderer, no VM).
 * @see https://bun.com/blog/bun-v1.3.12#render-markdown-in-the-terminal-with-bun-file-md
 */

import { join } from "path";
import { Effect } from "effect";
import { renderMarkdownAnsi } from "./bun-markdown.ts";
import { previewMarkdownWithBun } from "./markdown-table.ts";

/** file = write .md + print path (default); raw = stdout MD; table = inspect; csv = stdout CSV; json = stdout JSON */
export type PropertyTableOutputFormat = "file" | "raw" | "table" | "csv" | "json";

export interface PropertyTableRenderPayload {
  title: string;
  sourceLabel: string;
  markdown: string;
  rows: Record<string, string>[];
  columns: readonly string[];
}

const FORMAT_ALIASES: Record<string, PropertyTableOutputFormat> = {
  file: "file",
  raw: "raw",
  table: "table",
  csv: "csv",
  json: "json",
  markdown: "raw",
};

export function parsePropertyTableFormat(argv: readonly string[]): PropertyTableOutputFormat {
  const idx = argv.indexOf("--format");
  if (idx === -1) return "file";
  const value = argv[idx + 1];
  if (!value) return "file";
  if (value === "ansi") return "file";
  return FORMAT_ALIASES[value] ?? "file";
}

export function parseLegacyAnsiFlag(argv: readonly string[]): boolean {
  return argv.includes("--legacy-ansi");
}

/** True when argv uses deprecated `--format ansi`. */
export function propertyTableFormatDeprecated(argv: readonly string[]): boolean {
  const idx = argv.indexOf("--format");
  return idx !== -1 && argv[idx + 1] === "ansi";
}

export function defaultPropertyTableMarkdownPath(
  projectRoot: string,
  slug: string,
  options: { output?: string; outDir?: string } = {}
): string {
  if (options.output) return options.output;
  const dir = options.outDir ?? join(projectRoot, "docs");
  return join(dir, `table-${slug.replace(/\./g, "-")}.md`);
}

/** Bun.inspect.table for raw column inspection. */
export function formatPropertyTableInspect(payload: PropertyTableRenderPayload): string {
  return Bun.inspect.table(payload.rows, [...payload.columns]);
}

/** Stable JSON representation of the table payload. */
export function formatPropertyTableJson(payload: PropertyTableRenderPayload): string {
  return JSON.stringify(
    {
      title: payload.title,
      sourceLabel: payload.sourceLabel,
      columns: payload.columns,
      rows: payload.rows,
    },
    null,
    2
  );
}

/** JSON catalog keyed by the describe column. */
export function formatDescribeJson(payload: PropertyTableRenderPayload, keyColumn: string): string {
  const entries: Record<string, Record<string, string>> = {};
  for (const row of payload.rows) {
    const key = row[keyColumn]?.trim() ?? "";
    if (!key) continue;
    entries[key] = { ...row };
  }
  return JSON.stringify(
    {
      title: payload.title,
      sourceLabel: payload.sourceLabel,
      keyColumn,
      entries,
    },
    null,
    2
  );
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** RFC 4180-style CSV (optional header row + data rows). */
export function formatPropertyTableCsv(
  payload: PropertyTableRenderPayload,
  options: { noHeader?: boolean } = {}
): string {
  const dataLines = payload.rows.map((row) =>
    payload.columns.map((col) => escapeCsvCell(row[col] ?? "")).join(",")
  );
  const lines = options.noHeader
    ? dataLines
    : [payload.columns.map(escapeCsvCell).join(","), ...dataLines];
  return `${lines.join("\n")}\n`;
}

export interface EmitPropertyTableOptions {
  format: PropertyTableOutputFormat;
  markdownPath: string;
  legacyAnsi?: boolean;
  /** Render markdown in terminal via `bun <file.md>` after emit. */
  preview?: boolean;
  /** Omit CSV header row (--no-header). */
  noHeader?: boolean;
  /** Pre-built markdown for grouped raw stdout (--group-by). */
  groupedMarkdown?: string;
  /** Per-group file writes (--group-by + --format file). */
  groupedFileWrites?: Array<{ path: string; markdown: string }>;
  /** Key column for --describe JSON output. */
  describeKeyColumn?: string;
}

/**
 * Emit table per --format.
 * - file (default): write raw .md, stderr path + `bun <path>` hint
 * - raw: markdown to stdout (pipe/CI)
 * - table: Bun.inspect.table
 * - csv: RFC 4180 CSV to stdout (pipe/redirect)
 * - json: JSON object to stdout ({ title, sourceLabel, columns, rows }) or, with --describe, keyed entries
 * - --legacy-ansi: optional Bun.markdown.ansi to stdout after file write
 */
export function emitPropertyTableOutput(
  payload: PropertyTableRenderPayload,
  options: EmitPropertyTableOptions
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const {
      format,
      markdownPath,
      legacyAnsi,
      preview,
      noHeader,
      groupedMarkdown,
      groupedFileWrites,
      describeKeyColumn,
    } = options;

    if (groupedFileWrites && groupedFileWrites.length > 0) {
      for (const file of groupedFileWrites) {
        yield* Effect.tryPromise({
          try: () => Bun.write(file.path, file.markdown),
          catch: (err) =>
            new Error(
              `Failed to write ${file.path}: ${err instanceof Error ? err.message : String(err)}`
            ),
        });
        yield* Effect.sync(() => {
          process.stderr.write(`${file.path}\n`);
          process.stderr.write(`Preview: bun ${file.path}\n`);
        });
      }
      return;
    }

    if (format === "raw") {
      yield* Effect.sync(() => {
        const body = groupedMarkdown ?? payload.markdown.trim();
        process.stdout.write(`${body}\n`);
      });
    } else if (format === "table") {
      yield* Effect.sync(() => {
        process.stdout.write(`${formatPropertyTableInspect(payload)}\n`);
      });
    } else if (format === "csv") {
      yield* Effect.sync(() => {
        process.stdout.write(formatPropertyTableCsv(payload, { noHeader }));
      });
    } else if (format === "json") {
      yield* Effect.sync(() => {
        const body = describeKeyColumn
          ? formatDescribeJson(payload, describeKeyColumn)
          : formatPropertyTableJson(payload);
        process.stdout.write(`${body}\n`);
      });
    } else {
      yield* Effect.tryPromise({
        try: () => Bun.write(markdownPath, payload.markdown),
        catch: (err) =>
          new Error(
            `Failed to write ${markdownPath}: ${err instanceof Error ? err.message : String(err)}`
          ),
      });

      yield* Effect.sync(() => {
        process.stderr.write(`${markdownPath}\n`);
        process.stderr.write(`Preview: bun ${markdownPath}\n`);
      });

      if (legacyAnsi) {
        const body = payload.markdown.trim();
        const fullMd = body.startsWith("#") ? body : `# ${payload.title}\n\n${body}`;
        const ansi = renderMarkdownAnsi(fullMd, { hyperlinks: true });
        yield* Effect.sync(() => {
          process.stdout.write(`${ansi}\n`);
        });
      }
    }

    if (preview) {
      const previewPath =
        format === "file"
          ? markdownPath
          : join(
              Bun.env.TMPDIR ?? "/tmp",
              `dx-table-preview-${Bun.hash(payload.markdown).toString(16)}.md`
            );
      if (format !== "file") {
        yield* Effect.tryPromise({
          try: () => Bun.write(previewPath, payload.markdown),
          catch: (err) =>
            new Error(
              `Failed to write preview file: ${err instanceof Error ? err.message : String(err)}`
            ),
        });
      }
      const rendered = yield* Effect.tryPromise({
        try: () => previewMarkdownWithBun(previewPath),
        catch: (err) =>
          new Error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`),
      });
      if (rendered.exitCode !== 0) {
        return yield* Effect.fail(
          new Error(rendered.stderr.trim() || `bun preview exited ${rendered.exitCode}`)
        );
      }
      yield* Effect.sync(() => {
        if (rendered.stdout) process.stdout.write(`${rendered.stdout}\n`);
      });
    }
  });
}
