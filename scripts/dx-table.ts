#!/usr/bin/env bun
/**
 * dx:table — Extract TOML config sections or TypeScript JSDoc classes as property tables.
 *
 * Core extraction:
 *   bun run dx:table extract <config.toml> <key.path> [--format <fmt>] [flags]
 *
 * Examples:
 *   # Quick inspection (Bun.inspect.table)
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format table
 *
 *   # Default: write docs/table-<slug>.md (path printed on stderr)
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts
 *
 *   # Pipe-friendly markdown (no metadata); --format markdown is alias for raw
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format raw --exact
 *
 *   # Full audit view (LastModified + SourceFile)
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format table
 *
 *   # Sorted handoff rules + terminal preview
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.handoff_rules --sort-by FromWorkspace --preview
 *
 *   # URL decomposition (keeps original url column)
 *   bun run dx:table extract dx.config.toml endpoints --format raw -u
 *
 *   # Decomposed URL parts only
 *   bun run dx:table extract dx.config.toml endpoints --format table -u --hide-source-url --exact
 *
 *   # CI: validate rows against schema before emitting CSV
 *   bun run dx:table extract dx.config.toml endpoints -u --exact \
 *     --schema schemas/endpoints.schema.toml --format csv > endpoints.csv
 */

import { Effect } from "effect";
import { runCliExit } from "../src/lib/effect/cli-runtime.ts";
import { CliError } from "../src/lib/effect/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import {
  parseInventoryRootsArg,
  runPropertyTableInventoryEffect,
} from "../src/lib/property-table-inventory.ts";
import { loadMergedConfigDocument } from "../src/lib/dx-config-parse.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";
import { listTomlPropertyTablePaths } from "../src/lib/toml-property-table.ts";
import type { PropertyTableOutputFormat } from "../src/lib/property-table-renderer.ts";
import { TOOLCHAIN_VERSION } from "../src/lib/version.ts";

const TOOL = "dx:table";
const logger = createLogger(Bun.argv, TOOL);

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

function parseInventoryArgs(argv: string[]): {
  table?: string;
  roots?: string;
  configFile?: string;
  projectRoot: string;
  format?: PropertyTableOutputFormat;
  help?: boolean;
} {
  let table: string | undefined;
  let roots: string | undefined;
  let configFile: string | undefined;
  let projectRoot = process.cwd();
  let format: PropertyTableOutputFormat | undefined;
  let help = false;

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--roots") roots = argv[++i];
    else if (arg === "--config") configFile = argv[++i];
    else if (arg === "--project") projectRoot = argv[++i] ?? projectRoot;
    else if (arg === "--format") {
      const value = argv[++i];
      if (
        value === "csv" ||
        value === "json" ||
        value === "raw" ||
        value === "table" ||
        value === "file" ||
        value === "markdown"
      ) {
        format = value === "markdown" ? "raw" : value;
      }
    } else if (arg === "--decompose-urls" || arg === "-u") continue;
    else if (arg === "--hide-source-url" || arg === "--no-source-url") continue;
    else if (
      arg === "--exact" ||
      arg === "--preview" ||
      arg === "--legacy-ansi" ||
      arg === "--no-header" ||
      arg === "--transpose" ||
      arg === "--describe" ||
      arg === "--schema-warn"
    ) {
      continue;
    } else if (arg === "--add-metadata") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i++;
    } else if (
      arg === "--sort-by" ||
      arg === "--columns" ||
      arg === "--filter" ||
      arg === "--group-by" ||
      arg === "--keys" ||
      arg === "--schema"
    ) {
      i++;
    } else if (arg === "--help" || arg === "-h") help = true;
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  if (!table && positional.length >= 1) table = positional[0];
  if (!roots) roots = readFlagValue(argv, "--roots");

  return { table, roots, configFile, projectRoot, format, help };
}

function parseExtractArgs(argv: string[]): {
  file?: string;
  table?: string;
  allTables?: boolean;
  className?: string;
  output?: string;
  outDir?: string;
  projectRoot: string;
  format?: PropertyTableOutputFormat;
  resolved?: boolean;
  help?: boolean;
} {
  let file: string | undefined;
  let table: string | undefined;
  let allTables = false;
  let className: string | undefined;
  let output: string | undefined;
  let outDir: string | undefined;
  let projectRoot = process.cwd();
  let format: PropertyTableOutputFormat | undefined;
  let help = false;

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") file = argv[++i];
    else if (arg === "--class") className = argv[++i];
    else if (arg === "--table") table = argv[++i];
    else if (arg === "--output") output = argv[++i];
    else if (arg === "--out-dir") outDir = argv[++i];
    else if (arg === "--project") projectRoot = argv[++i] ?? projectRoot;
    else if (arg === "--format") {
      const value = argv[++i];
      if (
        value === "file" ||
        value === "raw" ||
        value === "table" ||
        value === "csv" ||
        value === "json" ||
        value === "markdown"
      ) {
        format = value === "markdown" ? "raw" : value;
      }
    } else if (arg === "--all") allTables = true;
    else if (arg === "--resolved") continue;
    else if (arg === "--decompose-urls" || arg === "-u") continue;
    else if (arg === "--hide-source-url" || arg === "--no-source-url") continue;
    else if (
      arg === "--exact" ||
      arg === "--preview" ||
      arg === "--legacy-ansi" ||
      arg === "--no-header" ||
      arg === "--transpose" ||
      arg === "--describe" ||
      arg === "--schema-warn"
    ) {
      continue;
    } else if (arg === "--add-metadata") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) i++;
    } else if (
      arg === "--sort-by" ||
      arg === "--columns" ||
      arg === "--filter" ||
      arg === "--group-by" ||
      arg === "--keys" ||
      arg === "--schema"
    ) {
      i++;
    } else if (arg === "--help" || arg === "-h") help = true;
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  const resolved = argv.includes("--resolved");
  if (resolved) {
    if (!table && positional.length >= 1) table = positional[0];
  } else {
    if (!file && positional.length >= 1) file = positional[0];
    if (!table && positional.length >= 2) table = positional[1];
  }

  return {
    file,
    table,
    allTables,
    className,
    output,
    outDir,
    projectRoot,
    format,
    resolved,
    help,
  };
}

function printHelp(): void {
  logger.info("Core: bun run dx:table extract <config.toml> <key.path> [--format <fmt>] [flags]");
  logger.info("      bun run dx:table extract --resolved <key.path> [--format <fmt>] [flags]");
  logger.info("      bun run dx:table extract <config.toml> --all [--format <fmt>] [flags]");
  logger.info(
    "      bun run dx:table extract --file <path.ts> --class <Name> [--format <fmt>] [flags]"
  );
  logger.info("");
  logger.info("Formats (--format): file (default) | raw | table | csv | json  (markdown → raw)");
  logger.info("  file  — write docs/table-<slug>.md; path + preview hint on stderr");
  logger.info("  raw   — markdown to stdout (pipe/CI)");
  logger.info("  table — Bun.inspect.table terminal view");
  logger.info("  csv   — RFC 4180 CSV to stdout (e.g. > endpoints.csv)");
  logger.info("  json  — JSON object to stdout ({ title, sourceLabel, columns, rows })");
  logger.info("");
  logger.info("CSV / projection:");
  logger.info("  --columns COL,COL  — output subset of columns (order preserved)");
  logger.info("  --filter COL=VAL   — keep rows where column equals value (repeatable, AND)");
  logger.info("  --no-header        — omit CSV header row (--format csv)");
  logger.info("");
  logger.info("Grouping:");
  logger.info("  --group-by COL     — split by column (markdown sections or one file per group)");
  logger.info("  --transpose        — flip columns ↔ rows (Field + one column per row)");
  logger.info("                     default out-dir for groups: docs/groups/");
  logger.info("");
  logger.info("Describe catalog:");
  logger.info("  --describe         — key-indexed sections instead of a table");
  logger.info("  --keys COL         — section key column (required with --describe)");
  logger.info("                     default out-dir: docs/describe/");
  logger.info("");
  logger.info("Config metadata (multi-repo CSV inventory):");
  logger.info("  --add-metadata [FIELDS] — repeat config scalars on every row");
  logger.info("                     default: schemaVersion,name,scope");
  logger.info("                     dot-paths ok (e.g. runtime.bunVersion); skipped with --exact");
  logger.info(
    "                     use TOML paths in --add-metadata; colliding fields → config.<field>"
  );
  logger.info("");
  logger.info("Multi-repo inventory:");
  logger.info("  dx:table inventory <table.path> --roots DIR,DIR [--format csv|json]");
  logger.info("                     merges rows; requires --add-metadata; default format csv");
  logger.info("");
  logger.info("Config resolution:");
  logger.info("  --resolved         — use merged project config path (global + dx.config.toml)");
  logger.info("");
  logger.info("Output: --format file (default) writes docs/table-<key-slug>.md");
  logger.info("        Override dir with --out-dir; explicit path with --output");
  logger.info("");
  logger.info("Examples:");
  logger.info("  dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format table");
  logger.info(
    "  dx:table extract dx.config.toml herdr.orchestrator.remote_hosts --format raw --exact"
  );
  logger.info(
    "  dx:table extract dx.config.toml herdr.orchestrator.handoff_rules --sort-by FromWorkspace --preview"
  );
  logger.info("  dx:table extract dx.config.toml endpoints --format raw -u");
  logger.info(
    "  dx:table extract dx.config.toml endpoints --format table -u --hide-source-url --exact"
  );
  logger.info(
    "  dx:table extract dx.config.toml endpoints -u --format csv --columns name,url_hostname,url_port --filter name=users"
  );
  logger.info(
    "  dx:table extract dx.config.toml endpoints -u --group-by url_hostname --format markdown --exact"
  );
  logger.info(
    "  dx:table extract dx.config.toml endpoints -u --group-by url_hostname --transpose --out-dir docs/groups --exact"
  );
  logger.info(
    "  dx:table extract dx.config.toml endpoints -u --exact --schema schemas/endpoints.schema.toml --format csv"
  );
  logger.info("  dx:table extract dx.config.toml endpoints --describe --keys name --exact");
  logger.info(
    "  dx:table extract dx.config.toml endpoints --describe --keys name --format json --exact"
  );
  logger.info(
    "  dx:table extract dx.config.toml endpoints --format csv --add-metadata schemaVersion,name,runtime.bunVersion"
  );
  logger.info(
    "  dx:table inventory endpoints --roots .,../other --add-metadata schemaVersion,name"
  );
  logger.info("");
  logger.info("  --out-dir DIR  — output directory (default: docs/)");
  logger.info("  --legacy-ansi  — optional Bun.markdown.ansi after file write");
  logger.info("  --all          — extract every registered TOML table");
  logger.info("  --exact        — omit metadata columns (LastModified, SourceFile)");
  logger.info("  --sort-by COL  — sort rows by column (bare --sort-by uses first data column)");
  logger.info("  --preview         — render markdown in terminal via bun <file.md>");
  logger.info(
    "  --decompose-urls, -u — append url_protocol, url_hostname, url_port, url_pathname, url_search, url_hash"
  );
  logger.info("  --hide-source-url    — with --decompose-urls, omit original URL column(s)");
  logger.info("  (--no-source-url is an alias for --hide-source-url)");
  logger.info("");
  logger.info("Schema validation (CI):");
  logger.info("  --schema FILE      — validate output rows/columns against TOML or JSON schema");
  logger.info("  --schema-warn      — print violations to stderr but do not fail");
  logger.info("  bun run dx:table:contract — verify schemas/endpoints*.schema.toml on fixture");
  logger.info("  See docs/dx-table.md and schemas/README.md");
  logger.info("");
  logger.info(`TOML tables: ${listTomlPropertyTablePaths().join(", ")}`);
  logger.info("TypeScript: --file PATH --class NAME (interface, class, or type literal)");
  logger.info("");
  logger.info("  --version, -v  — print tool version");
}

function printVersion(): void {
  console.log(`dx:table v${TOOLCHAIN_VERSION}`);
}

const program = Effect.gen(function* () {
  const argv = Bun.argv.slice(2);
  const sub = argv[0];

  if (sub === "--version" || sub === "-v") {
    printVersion();
    return 0;
  }

  if (!sub || sub === "--help" || sub === "-h") {
    printHelp();
    return 0;
  }

  if (sub === "inventory") {
    const inv = parseInventoryArgs(argv.slice(1));
    if (inv.help) {
      printHelp();
      return 0;
    }
    if (!inv.table) {
      return yield* Effect.fail(
        new CliError({
          message: "Missing table path (positional): dx:table inventory <table.path>",
        })
      );
    }
    if (!inv.roots) {
      return yield* Effect.fail(
        new CliError({ message: "Missing --roots DIR,DIR (comma-separated project roots)" })
      );
    }

    const roots = parseInventoryRootsArg(inv.roots);
    yield* runPropertyTableInventoryEffect({
      table: inv.table,
      roots,
      configFile: inv.configFile,
      format: inv.format,
      argv: argv.slice(1),
    }).pipe(
      Effect.mapError(
        (err) =>
          new CliError({
            message: err instanceof Error ? err.message : String(err),
          })
      )
    );
    logger.info(`Inventory: ${inv.table} from ${roots.length} root(s)`);
    return 0;
  }

  if (sub !== "extract") {
    return yield* Effect.fail(
      new CliError({ message: `Unknown command: ${sub}. Use: dx:table extract | inventory` })
    );
  }

  const args = parseExtractArgs(argv.slice(1));
  if (args.help) {
    printHelp();
    return 0;
  }

  let configFile = args.file;
  if (args.resolved) {
    const meta = yield* Effect.tryPromise({
      try: () => loadMergedConfigDocument(args.projectRoot),
      catch: (cause) =>
        new CliError({
          message: cause instanceof Error ? cause.message : Bun.inspect(cause),
        }),
    });
    if (!meta.projectPath) {
      return yield* Effect.fail(
        new CliError({
          message:
            "No project config found for --resolved (expected dx.config.toml or .dx/config.toml)",
        })
      );
    }
    configFile = meta.projectPath;
  }

  if (!configFile) {
    return yield* Effect.fail(
      new CliError({ message: "Missing file (positional, --file, or --resolved)" })
    );
  }
  if (!args.table && !args.className && !args.allTables) {
    return yield* Effect.fail(
      new CliError({
        message: "Missing table path (positional), --class for TypeScript, or --all",
      })
    );
  }

  const tables = args.allTables ? listTomlPropertyTablePaths() : [args.table!];
  const results: { payload: { sourceLabel: string }; markdownPath: string }[] = [];

  for (const table of tables) {
    const result = yield* runPropertyTableExtractEffect({
      projectRoot: args.projectRoot,
      file: configFile,
      table,
      className: args.className,
      output: args.output,
      outDir: args.outDir,
      format: args.format,
      argv: argv.slice(1),
    });
    results.push(result);
  }

  if (results.length === 1) {
    logger.info(`Extracted: ${results[0].payload.sourceLabel}`);
  } else {
    logger.info(`Extracted ${results.length} tables from ${configFile}`);
  }

  return 0;
});

if (import.meta.main) {
  const exitCode = await runCliExit(program, { toolName: TOOL, logger });
  process.exit(exitCode);
}
