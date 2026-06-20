/**
 * Merge TOML table extracts across multiple project roots (--roots).
 */

import { join, resolve } from "path";
import { Effect } from "effect";
import { writeStdout, writeStdoutLine } from "./cli-contract.ts";
import { pathExists } from "./bun-io.ts";
import { emptyToEmDash } from "./markdown-table.ts";
import {
  formatPropertyTableCsv,
  formatPropertyTableJson,
  parsePropertyTableFormat,
  type PropertyTableOutputFormat,
  type PropertyTableRenderPayload,
} from "./property-table-renderer.ts";
import { parseTableExtractFlags } from "./property-table-options.ts";
import { preparePropertyTableExtract } from "./property-table-run.ts";

export interface PropertyTableInventoryInput {
  table: string;
  roots: readonly string[];
  configFile?: string;
  format?: PropertyTableOutputFormat;
  argv?: readonly string[];
}

export function parseInventoryRootsArg(raw: string): string[] {
  const roots = raw
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean);
  if (roots.length === 0) {
    throw new Error("Invalid --roots (empty list)");
  }
  return roots;
}

function padRow(row: Record<string, string>, columns: readonly string[]): Record<string, string> {
  return Object.fromEntries(columns.map((col) => [col, row[col] ?? emptyToEmDash(null)]));
}

function unionColumns(existing: string[], incoming: readonly string[]): string[] {
  const out = [...existing];
  for (const col of incoming) {
    if (!out.includes(col)) out.push(col);
  }
  return out;
}

export async function buildPropertyTableInventory(
  input: PropertyTableInventoryInput
): Promise<PropertyTableRenderPayload> {
  const argv = input.argv ?? [];
  const flags = parseTableExtractFlags(argv);
  const configFile = input.configFile ?? "dx.config.toml";
  const mergedRows: Record<string, string>[] = [];
  let columns: string[] = [];
  const labels: string[] = [];

  for (const root of input.roots) {
    const projectRoot = resolve(root);
    const configPath = join(projectRoot, configFile);
    if (!pathExists(configPath)) {
      throw new Error(`Config not found: ${configPath}`);
    }

    const prepared = await preparePropertyTableExtract(
      {
        projectRoot,
        file: configFile,
        table: input.table,
        argv,
      },
      flags
    );
    columns =
      columns.length === 0 ? [...prepared.columns] : unionColumns(columns, prepared.columns);
    for (const row of prepared.rows) {
      mergedRows.push(padRow(row, columns));
    }
    labels.push(projectRoot);
  }

  const title = input.table;
  const sourceLabel = `inventory (${labels.length} roots): ${labels.join(", ")}`;
  return {
    title,
    sourceLabel,
    markdown: "",
    rows: mergedRows,
    columns,
  };
}

export function runPropertyTableInventoryEffect(
  input: PropertyTableInventoryInput
): Effect.Effect<PropertyTableRenderPayload, Error> {
  return Effect.gen(function* () {
    const argv = input.argv ?? [];
    const format =
      input.format ?? (argv.includes("--format") ? parsePropertyTableFormat(argv) : "csv");
    if (format !== "csv" && format !== "json") {
      return yield* Effect.fail(new Error("--format inventory supports csv (default) or json"));
    }

    const flags = parseTableExtractFlags(argv);
    if (flags.describe) {
      return yield* Effect.fail(new Error("inventory does not support --describe"));
    }
    if (!flags.addMetadata) {
      return yield* Effect.fail(
        new Error("inventory requires --add-metadata (config columns for cross-project joins)")
      );
    }

    const payload = yield* Effect.tryPromise({
      try: () => buildPropertyTableInventory(input),
      catch: (err) => (err instanceof Error ? err : new Error(Bun.inspect(err))),
    });

    const noHeader = flags.noHeader;
    const body =
      format === "json"
        ? formatPropertyTableJson(payload)
        : formatPropertyTableCsv(payload, { noHeader });
    yield* Effect.tryPromise({
      try: async () => {
        if (body.endsWith("\n")) await writeStdout(body);
        else await writeStdoutLine(body);
      },
      catch: () => new Error("stdout-write"),
    });

    return payload;
  });
}
