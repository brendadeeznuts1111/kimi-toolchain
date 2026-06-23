#!/usr/bin/env bun
/**
 * dx:property-table — JSDoc property tables (TypeScript classes).
 *
 *   bun run dx:property-table
 *   bun run dx:table extract --file src/foo.ts --class AppConfig
 */

import { Effect } from "effect";
import { runCliExit } from "../src/lib/effect/cli-runtime.ts";
import { CliError } from "../src/lib/effect/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import { readPropertyTableDxConfig } from "../src/lib/property-table-config.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";

const TOOL = "dx:property-table";
const logger = createLogger(Bun.argv, TOOL);

function parseCliArgs(argv: string[]): {
  file?: string;
  className?: string;
  output?: string;
  outDir?: string;
  projectRoot: string;
} {
  let file: string | undefined;
  let className: string | undefined;
  let output: string | undefined;
  let outDir: string | undefined;
  let projectRoot = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") file = argv[++i];
    else if (arg === "--class") className = argv[++i];
    else if (arg === "--output") output = argv[++i];
    else if (arg === "--out-dir") outDir = argv[++i];
    else if (arg === "--project") projectRoot = argv[++i] ?? projectRoot;
    else if (arg === "--format") i++;
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
    } else if (arg === "--help" || arg === "-h") {
      logger.info(
        "Usage: bun run dx:property-table [--file PATH] [--class NAME] [--format file|raw|table]"
      );
      logger.info("Or: bun run dx:table extract --file PATH --class NAME");
      logger.info("");
      logger.info("  --exact        — omit LastModified, SourceFile");
      logger.info("  --sort-by COL  — sort by Property (default first column if bare --sort-by)");
      logger.info("  --preview      — render markdown via bun <file.md>");
      logger.info(
        "  --decompose-urls, -u — append url_protocol, url_hostname, url_port, url_pathname, url_search, url_hash"
      );
      logger.info("  --hide-source-url / --no-source-url — omit original URL column(s)");
      logger.info("  --columns COL,COL — column subset; --filter COL=VAL; --no-header (csv)");
      logger.info("  --schema FILE — validate output; --schema-warn — warn only");
      process.exit(0);
    }
  }

  return { file, className, output, outDir, projectRoot };
}

const program = Effect.gen(function* () {
  const argv = Bun.argv.slice(2);
  const args = parseCliArgs(argv);
  const dx = yield* Effect.promise(() => readPropertyTableDxConfig(args.projectRoot));

  const file = args.file ?? dx.file;
  const className = args.className ?? dx.class;
  if (!file) {
    return yield* Effect.fail(
      new CliError({
        message: "Missing --file (or [dx.propertyTable] file in dx.config.toml)",
      })
    );
  }

  yield* runPropertyTableExtractEffect({
    projectRoot: args.projectRoot,
    file,
    className,
    output: args.output ?? dx.output,
    outDir: args.outDir,
    argv,
  });

  return 0;
});

if (import.meta.main) {
  const exitCode = await runCliExit(program, { toolName: TOOL, logger });
  process.exit(exitCode);
}
