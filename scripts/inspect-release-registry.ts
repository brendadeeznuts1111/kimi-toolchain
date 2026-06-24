#!/usr/bin/env bun
/**
 * Inspect Bun release registry — table, JSON, metrics.
 *
 *   bun run release:info
 *   bun run release:info -- --breaking
 *   bun run release:info -- --properties version,breaking
 *   bun run release:info -- --properties version,breaking --quiet
 */

import { inspect } from "bun";
import {
  formatReleaseHistoryMarkdown,
  formatReleaseHistoryTable,
  RELEASE_HISTORY_FULL_PROPERTIES,
  resolveReleaseTableProperties,
} from "../src/lib/bun-release-inspect.ts";
import {
  BUN_RELEASE,
  BUN_RELEASE_HISTORY,
  BUN_RELEASE_PREVIOUS,
  breakingChangeCount,
  buildReleaseHistoryRows,
  measureReleaseHistoryRows,
  type ReleaseHistoryMetrics,
  type ReleaseHistoryRow,
} from "../src/lib/bun-release-registry.ts";

const INSPECT_OPTS = {
  colors: false,
  depth: Number.POSITIVE_INFINITY,
  sorted: true,
  compact: true,
  maxArrayLength: Infinity,
  maxStringLength: Infinity,
  breakLength: Infinity,
};

interface CliOptions {
  format: "table" | "json" | "inspect" | "metrics" | "md";
  colors: boolean;
  sorted: boolean;
  properties?: readonly string[];
  summary: boolean;
  breaking: boolean;
  quiet: boolean;
}

function parseCli(argv: string[]): CliOptions {
  let format: CliOptions["format"] = "table";
  let colors = false;
  let sorted = true;
  let summary = false;
  let breaking = false;
  let quiet = false;
  let properties: readonly string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format") {
      const next = argv[i + 1];
      if (
        next === "table" ||
        next === "json" ||
        next === "inspect" ||
        next === "metrics" ||
        next === "md"
      ) {
        format = next;
      }
    } else if (arg === "--colors") {
      colors = true;
    } else if (arg === "--no-sorted") {
      sorted = false;
    } else if (arg === "--sorted") {
      sorted = true;
    } else if (arg === "--summary") {
      summary = true;
    } else if (arg === "--breaking") {
      breaking = true;
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (arg === "--properties") {
      const next = argv[i + 1];
      if (next)
        properties = next
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
    }
  }

  properties = resolveReleaseTableProperties(properties, { breaking, summary });

  return { format, colors, sorted, properties, summary, breaking, quiet };
}

function printMetrics(metrics: ReleaseHistoryMetrics): void {
  console.log(`Rows: ${metrics.rowCount}`);
  console.log(`Fields: ${metrics.fieldKeys.join(", ")}`);
  console.log(`Sum of column name widths: ${metrics.columnNameWidthSum}`);
  console.log(`Total JSON serialized length: ${metrics.jsonSerializedLength}`);
  console.log(`Total display width (Bun.stringWidth): ${metrics.displayWidth}`);
  console.log(`Current ≡ previous? ${metrics.currentEqualsPrevious}`);
}

function printReleaseFootnote(rows: ReleaseHistoryRow[], verbose: boolean): void {
  const current = rows.find((r) => r.role === "current");
  const previous = rows.find((r) => r.role === "previous");
  if (!current) return;

  const currentBreaking = breakingChangeCount(BUN_RELEASE.breaking);
  const previousBreaking = breakingChangeCount(BUN_RELEASE_PREVIOUS.breaking);
  const parts = [
    `current ${current.version}`,
    currentBreaking === 0 ? "clean" : `${currentBreaking} breaking`,
    previous
      ? `previous ${previous.version} (${previousBreaking === 0 ? "clean" : `${previousBreaking} breaking`})`
      : "",
  ].filter(Boolean);

  console.log(`\n→ ${parts.join(" · ")}`);
  if (verbose) {
    console.log(`  pin: ${BUN_RELEASE.tag} @ ${BUN_RELEASE.hash.slice(0, 12)}…`);
    console.log(`  blog: ${BUN_RELEASE.blogUrl}`);
  }
}

async function main(): Promise<void> {
  const cli = parseCli(Bun.argv.slice(2));
  const rows = buildReleaseHistoryRows(BUN_RELEASE_HISTORY);
  const metrics = measureReleaseHistoryRows(rows);
  const showFootnote = cli.format === "table" || cli.format === "md";

  if (cli.format === "json") {
    console.log(
      JSON.stringify(
        {
          rows,
          metrics,
          current: BUN_RELEASE,
          previous: BUN_RELEASE_PREVIOUS,
          properties: cli.properties ?? RELEASE_HISTORY_FULL_PROPERTIES,
        },
        null,
        2
      )
    );
    return;
  }

  if (cli.format === "inspect") {
    console.log(inspect(rows, INSPECT_OPTS));
    if (!cli.quiet) printMetrics(metrics);
    return;
  }

  if (cli.format === "metrics") {
    printMetrics(metrics);
    return;
  }

  if (cli.format === "md") {
    const md = formatReleaseHistoryMarkdown(
      rows,
      cli.properties ?? RELEASE_HISTORY_FULL_PROPERTIES
    );
    console.log(md);
    if (!cli.quiet) {
      printReleaseFootnote(rows, !cli.quiet);
      printMetrics(metrics);
    }
    return;
  }

  const table = formatReleaseHistoryTable(rows, cli.properties, {
    colors: cli.colors,
    sorted: cli.sorted,
  });
  console.log(table);
  if (showFootnote) printReleaseFootnote(rows, !cli.quiet);
  if (!cli.quiet && !cli.properties) printMetrics(metrics);
}

if (import.meta.main) {
  await main();
}
