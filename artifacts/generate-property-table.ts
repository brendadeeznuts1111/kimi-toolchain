#!/usr/bin/env bun
/**
 * @deprecated Prefer `bun run dx:table extract` — same pipeline, Bun-native preview via `bun ./docs/table-*.md`
 *
 *   bun run dx:table extract dx.config.toml herdr.orchestrator.remote_hosts
 */

import { Effect } from "effect";
import { runCliExit } from "../src/lib/effect/cli-runtime.ts";
import { CliError } from "../src/lib/effect/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import { runPropertyTableExtractEffect } from "../src/lib/property-table-run.ts";
import { listTomlPropertyTablePaths } from "../src/lib/toml-property-table.ts";

const TOOL = "generate-property-table";
const logger = createLogger(Bun.argv, TOOL);

function parseCliArgs(argv: string[]): {
  file?: string;
  className?: string;
  table?: string;
  output?: string;
  outDir?: string;
  projectRoot: string;
} {
  let file: string | undefined;
  let className: string | undefined;
  let table: string | undefined;
  let output: string | undefined;
  let outDir: string | undefined;
  let projectRoot = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") file = argv[++i];
    else if (arg === "--class") className = argv[++i];
    else if (arg === "--table") table = argv[++i];
    else if (arg === "--output") output = argv[++i];
    else if (arg === "--out-dir") outDir = argv[++i];
    else if (arg === "--project") projectRoot = argv[++i] ?? projectRoot;
    else if (arg === "--format") i++;
    else if (arg === "--help" || arg === "-h") {
      logger.info("Deprecated — use: bun run dx:table extract <file> <table>");
      logger.info(`TOML tables: ${listTomlPropertyTablePaths().join(", ")}`);
      process.exit(0);
    }
  }

  return { file, className, table, output, outDir, projectRoot };
}

const program = Effect.gen(function* () {
  const argv = Bun.argv.slice(2);
  const args = parseCliArgs(argv);
  if (!args.file) {
    return yield* Effect.fail(new CliError({ message: "Missing --file" }));
  }

  yield* runPropertyTableExtractEffect({
    projectRoot: args.projectRoot,
    file: args.file,
    table: args.table,
    className: args.className,
    output: args.output,
    outDir: args.outDir,
    argv,
  });

  return 0;
});

if (import.meta.main) {
  const exitCode = await runCliExit(program, { toolName: TOOL, logger });
  process.exit(exitCode);
}
