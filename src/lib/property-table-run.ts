/**
 * Shared property-table extract pipeline (TOML tables + TypeScript JSDoc classes).
 */

import { dirname } from "path";
import { Effect } from "effect";
import { CliError } from "./effect/errors.ts";
import { readPropertyTableDxConfig, resolvePropertyTableInput } from "./property-table-config.ts";
import {
  defaultPropertyTableMarkdownPath,
  emitPropertyTableOutput,
  parseLegacyAnsiFlag,
  parsePropertyTableFormat,
  propertyTableFormatDeprecated,
  type PropertyTableOutputFormat,
  type PropertyTableRenderPayload,
} from "./property-table-renderer.ts";
import {
  buildPropertyTable,
  PROPERTY_TABLE_COLUMN_SPECS,
  PROPERTY_TABLE_COLUMNS,
} from "./property-table.ts";
import {
  applyTableRenderOptions,
  filterColumnSpecsForColumns,
  parseTableExtractFlags,
} from "./property-table-options.ts";
import {
  buildGroupedPayloads,
  defaultGroupedOutDir,
  formatGroupedMarkdownStdout,
  groupedMarkdownPath,
  transposeTable,
} from "./property-table-group.ts";
import {
  defaultDescribeOutDir,
  describeMarkdownPath,
  formatDescribeMarkdown,
} from "./property-table-describe.ts";
import { formatMarkdownPropertyTable } from "./markdown-table.ts";
import {
  formatTableSchemaViolations,
  loadTableSchema,
  validateTableAgainstSchema,
} from "./table-schema.ts";
import { loadTomlDocument } from "./property-table-metadata.ts";
import { TOML_PROPERTY_TABLE_REGISTRY, buildTomlPropertyTable } from "./toml-property-table.ts";
import { ensureDir } from "./utils.ts";
import type { MarkdownTableColumnSpec } from "./markdown-table.ts";

export interface PropertyTableRunInput {
  projectRoot: string;
  file: string;
  table?: string;
  className?: string;
  format?: PropertyTableOutputFormat;
  output?: string;
  outDir?: string;
  argv?: readonly string[];
}

interface PreparedTable {
  title: string;
  sourceLabel: string;
  filePath: string;
  columns: string[];
  rows: Record<string, string>[];
  columnSpecs?: readonly MarkdownTableColumnSpec[];
}

function renderPayloadFromTable(
  title: string,
  sourceLabel: string,
  filePath: string,
  columns: readonly string[],
  rows: Record<string, string>[],
  markdown: string
): PropertyTableRenderPayload {
  return { title, sourceLabel, markdown, rows, columns };
}

function finalizeTablePayload(prepared: PreparedTable): PropertyTableRenderPayload {
  const markdown = formatMarkdownPropertyTable({
    title: prepared.title,
    source: prepared.filePath,
    columns: prepared.columns,
    rows: prepared.rows,
    columnSpecs: prepared.columnSpecs,
  });

  return renderPayloadFromTable(
    prepared.title,
    prepared.sourceLabel,
    prepared.filePath,
    prepared.columns,
    prepared.rows,
    markdown
  );
}

/** Prepared table rows/columns after post-process flags (exported for inventory merge). */
export async function preparePropertyTableExtract(
  input: PropertyTableRunInput,
  flags: ReturnType<typeof parseTableExtractFlags>
): Promise<PreparedTable> {
  if (input.table) {
    const result = await buildTomlPropertyTable({
      projectRoot: input.projectRoot,
      filePath: input.file,
      tablePath: input.table,
    });
    const entry = TOML_PROPERTY_TABLE_REGISTRY[input.table];
    const parsedToml =
      flags.addMetadata && !flags.exact
        ? await loadTomlDocument(input.projectRoot, input.file)
        : undefined;
    const prepared = applyTableRenderOptions({
      columns: result.columns,
      rows: result.rows,
      filePath: result.filePath,
      exact: flags.exact,
      sortBy: flags.sortBy,
      sortByDefault: flags.sortByDefault,
      decomposeUrls: flags.decomposeUrls,
      noSourceUrl: flags.noSourceUrl,
      columnPick: flags.columnPick,
      filters: flags.filters,
      columnSpecs: entry?.columnSpecs,
      addMetadataFields: flags.addMetadata,
      parsedToml,
    });
    const columnSpecs = filterColumnSpecsForColumns(prepared.columnSpecs, prepared.columns);
    return {
      title: result.tablePath,
      sourceLabel: `${input.file} → ${input.table}`,
      filePath: result.filePath,
      columns: prepared.columns,
      rows: prepared.rows,
      columnSpecs,
    };
  }

  const dx = await readPropertyTableDxConfig(input.projectRoot);
  const resolved = resolvePropertyTableInput(
    input.projectRoot,
    { file: input.file, className: input.className },
    dx
  );
  const result = await buildPropertyTable({
    projectRoot: resolved.projectRoot,
    filePath: resolved.file,
    className: resolved.className,
  });
  const prepared = applyTableRenderOptions({
    columns: PROPERTY_TABLE_COLUMNS,
    rows: result.rows,
    filePath: resolved.file,
    exact: flags.exact,
    sortBy: flags.sortBy,
    sortByDefault: flags.sortByDefault,
    decomposeUrls: flags.decomposeUrls,
    noSourceUrl: flags.noSourceUrl,
    noHeader: flags.noHeader,
    columnPick: flags.columnPick,
    filters: flags.filters,
    columnSpecs: PROPERTY_TABLE_COLUMN_SPECS,
  });
  const columnSpecs = filterColumnSpecsForColumns(prepared.columnSpecs, prepared.columns);
  return {
    title: result.className,
    sourceLabel: `${resolved.file}#${resolved.className}`,
    filePath: resolved.file,
    columns: prepared.columns,
    rows: prepared.rows,
    columnSpecs,
  };
}

function assertGroupByColumn(prepared: PreparedTable, groupBy: string): void {
  if (prepared.columns.includes(groupBy)) return;
  const hint =
    groupBy.startsWith("url_") || groupBy === "url"
      ? " Use --decompose-urls (-u) to create url_* columns."
      : "";
  throw new Error(
    `Unknown --group-by column: ${groupBy}.${hint} Available: ${prepared.columns.join(", ")}`
  );
}

function assertDescribeKeyColumn(prepared: PreparedTable, keyColumn: string): void {
  if (prepared.columns.includes(keyColumn)) return;
  throw new Error(`Unknown --keys column: ${keyColumn}. Available: ${prepared.columns.join(", ")}`);
}

function finalizeDescribePayload(
  prepared: PreparedTable,
  keyColumn: string
): PropertyTableRenderPayload {
  const markdown = formatDescribeMarkdown({
    title: prepared.title,
    source: prepared.filePath,
    keyColumn,
    columns: prepared.columns,
    rows: prepared.rows,
  });
  return renderPayloadFromTable(
    prepared.title,
    prepared.sourceLabel,
    prepared.filePath,
    prepared.columns,
    prepared.rows,
    markdown
  );
}

function resolveDescribeEmitOptions(input: PropertyTableRunInput): { markdownPath: string } {
  const slug = input.table ?? input.className ?? "config";
  if (input.output) {
    return { markdownPath: input.output };
  }
  const outDir = defaultDescribeOutDir(input.projectRoot, input.outDir);
  return { markdownPath: describeMarkdownPath(outDir, slug) };
}

async function enforceTableSchema(
  projectRoot: string,
  schemaPath: string,
  schemaWarn: boolean,
  prepared: PreparedTable
): Promise<void> {
  const schema = await loadTableSchema(projectRoot, schemaPath);
  const violations = validateTableAgainstSchema(prepared.columns, prepared.rows, schema);
  if (violations.length === 0) return;

  const message = formatTableSchemaViolations(schemaPath, violations);
  if (schemaWarn) {
    process.stderr.write(`${message}\n`);
    return;
  }
  throw new Error(message);
}

function applyTranspose(prepared: PreparedTable): PreparedTable {
  const flipped = transposeTable(prepared.columns, prepared.rows);
  return {
    ...prepared,
    columns: flipped.columns,
    rows: flipped.rows,
    columnSpecs: flipped.columnSpecs ?? prepared.columnSpecs,
  };
}

function resolveEmitOptions(
  input: PropertyTableRunInput,
  flags: ReturnType<typeof parseTableExtractFlags>,
  format: PropertyTableOutputFormat,
  prepared: PreparedTable
): {
  markdownPath: string;
  groupedMarkdown?: string;
  groupedFileWrites?: Array<{ path: string; markdown: string }>;
} {
  const slug = input.table ?? input.className ?? "config";

  if (!flags.groupBy) {
    const markdownPath = defaultPropertyTableMarkdownPath(input.projectRoot, slug, {
      output: input.output,
      outDir: input.outDir,
    });
    return { markdownPath };
  }

  if (input.output) {
    throw new Error("--output cannot be used with --group-by (writes one file per group)");
  }

  if (format !== "raw" && format !== "file") {
    throw new Error("--group-by supports --format file (default) or --format markdown/raw");
  }

  assertGroupByColumn(prepared, flags.groupBy);
  const groups = buildGroupedPayloads({
    baseTitle: prepared.title,
    sourceLabel: prepared.sourceLabel,
    filePath: prepared.filePath,
    columns: prepared.columns,
    rows: prepared.rows,
    columnSpecs: prepared.columnSpecs,
    groupBy: flags.groupBy,
    transpose: flags.transpose,
  });

  if (format === "raw") {
    return {
      markdownPath: defaultPropertyTableMarkdownPath(input.projectRoot, slug, {
        outDir: input.outDir,
      }),
      groupedMarkdown: formatGroupedMarkdownStdout(groups),
    };
  }

  if (format === "file") {
    if (groups.length === 0) {
      throw new Error(`--group-by ${flags.groupBy}: no rows to group`);
    }
    const outDir = defaultGroupedOutDir(input.projectRoot, input.outDir);
    ensureDir(outDir);
    const groupedFileWrites = groups.map((group) => ({
      path: groupedMarkdownPath(outDir, slug, group.groupKey),
      markdown: group.markdown,
    }));
    return {
      markdownPath: groupedFileWrites[0]!.path,
      groupedFileWrites,
    };
  }

  return { markdownPath: defaultPropertyTableMarkdownPath(input.projectRoot, slug) };
}

export function runPropertyTableExtractEffect(
  input: PropertyTableRunInput
): Effect.Effect<{ payload: PropertyTableRenderPayload; markdownPath: string }, CliError> {
  return Effect.gen(function* () {
    const argv = input.argv ?? [];
    const format = input.format ?? parsePropertyTableFormat(argv);
    if (propertyTableFormatDeprecated(argv)) {
      yield* Effect.sync(() => {
        process.stderr.write(
          "Note: --format ansi is removed; use default (file) + bun ./table.md or --legacy-ansi\n"
        );
      });
    }

    let className = input.className;
    if (!input.table && !className) {
      const dx = yield* Effect.tryPromise({
        try: () => readPropertyTableDxConfig(input.projectRoot),
        catch: (err) =>
          new CliError({
            message: err instanceof Error ? err.message : String(err),
          }),
      });
      className = dx.class;
      if (!className) {
        return yield* Effect.fail(
          new CliError({
            message: "Missing table path or --class (or [dx.propertyTable] in dx.config.toml)",
          })
        );
      }
    }

    const flags = parseTableExtractFlags(argv);
    const prepared = yield* Effect.tryPromise({
      try: () => preparePropertyTableExtract({ ...input, className }, flags),
      catch: (err) =>
        new CliError({
          message: err instanceof Error ? err.message : String(err),
        }),
    });

    if (flags.describe && flags.groupBy) {
      return yield* Effect.fail(
        new CliError({ message: "--describe cannot be used with --group-by" })
      );
    }
    if (flags.describe && flags.transpose) {
      return yield* Effect.fail(
        new CliError({ message: "--describe cannot be used with --transpose" })
      );
    }
    if (flags.describe && flags.addMetadata) {
      return yield* Effect.fail(
        new CliError({ message: "--describe cannot be used with --add-metadata" })
      );
    }
    if (flags.addMetadata && !input.table) {
      return yield* Effect.fail(
        new CliError({
          message: "--add-metadata requires a TOML table extract (positional table path)",
        })
      );
    }

    let tableForEmit = prepared;
    if (flags.transpose && !flags.groupBy && !flags.describe) {
      tableForEmit = applyTranspose(prepared);
    }

    if (flags.schemaPath) {
      yield* Effect.tryPromise({
        try: () =>
          enforceTableSchema(input.projectRoot, flags.schemaPath!, flags.schemaWarn, tableForEmit),
        catch: (err) =>
          new CliError({
            message: err instanceof Error ? err.message : String(err),
          }),
      });
    }

    if (flags.describe) {
      const keyColumn = flags.describeKeys;
      if (!keyColumn) {
        return yield* Effect.fail(
          new CliError({ message: "--describe requires --keys COL (e.g. --keys name)" })
        );
      }
      if (format === "table" || format === "csv") {
        return yield* Effect.fail(
          new CliError({
            message: "--describe supports --format file (default), markdown/raw, or json",
          })
        );
      }
      assertDescribeKeyColumn(tableForEmit, keyColumn);
      const payload = finalizeDescribePayload(tableForEmit, keyColumn);
      const emitPaths = resolveDescribeEmitOptions(input);
      ensureDir(dirname(emitPaths.markdownPath));

      yield* emitPropertyTableOutput(payload, {
        format,
        markdownPath: emitPaths.markdownPath,
        legacyAnsi: parseLegacyAnsiFlag(argv),
        preview: flags.preview,
        noHeader: flags.noHeader,
        describeKeyColumn: keyColumn,
      }).pipe(
        Effect.mapError(
          (err) =>
            new CliError({
              message: err instanceof Error ? err.message : String(err),
            })
        )
      );

      return { payload, markdownPath: emitPaths.markdownPath };
    }

    const payload = finalizeTablePayload(tableForEmit);
    const emitPaths = resolveEmitOptions(input, flags, format, prepared);
    ensureDir(dirname(emitPaths.markdownPath));

    yield* emitPropertyTableOutput(payload, {
      format,
      markdownPath: emitPaths.markdownPath,
      legacyAnsi: parseLegacyAnsiFlag(argv),
      preview: flags.preview,
      noHeader: flags.noHeader,
      groupedMarkdown: emitPaths.groupedMarkdown,
      groupedFileWrites: emitPaths.groupedFileWrites,
    }).pipe(
      Effect.mapError(
        (err) =>
          new CliError({
            message: err instanceof Error ? err.message : String(err),
          })
      )
    );

    return { payload, markdownPath: emitPaths.markdownPath };
  });
}
