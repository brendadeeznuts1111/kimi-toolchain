#!/usr/bin/env bun
/**
 * dx:table schema contracts — verify fixture output matches schemas/*.schema.toml
 *
 *   bun run dx:table:contract
 *
 * Uses preparePropertyTableExtract + validateTableAgainstSchema (same as unit tests;
 * no Bun.inspect.table stdout).
 */

import { Effect } from "effect";
import { runCliExit } from "../src/lib/effect/cli-runtime.ts";
import { CliError } from "../src/lib/effect/errors.ts";
import { createLogger } from "../src/lib/logger.ts";
import { parseTableExtractFlags } from "../src/lib/property-table-options.ts";
import { preparePropertyTableExtract } from "../src/lib/property-table-run.ts";
import {
  formatTableSchemaViolations,
  loadTableSchema,
  validateTableAgainstSchema,
} from "../src/lib/table-schema.ts";

const TOOL = "dx:table:contract";
const logger = createLogger(Bun.argv, TOOL);

const FIXTURE = "test/fixtures/dx-url-endpoints.toml";
const TABLE = "endpoints";
const PIPELINE_FLAGS = ["-u", "--exact"] as const;

const CONTRACTS = [
  { label: "endpoints", schema: "schemas/endpoints.schema.toml" },
  { label: "endpoints-strict", schema: "schemas/endpoints-strict.schema.toml" },
] as const;

const program = Effect.gen(function* () {
  const projectRoot = process.cwd();
  const flags = parseTableExtractFlags([...PIPELINE_FLAGS]);

  const prepared = yield* Effect.tryPromise({
    try: () =>
      preparePropertyTableExtract(
        { projectRoot, file: FIXTURE, table: TABLE, argv: [...PIPELINE_FLAGS] },
        flags
      ),
    catch: (err) =>
      new CliError({
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  for (const contract of CONTRACTS) {
    const schema = yield* Effect.tryPromise({
      try: () => loadTableSchema(projectRoot, contract.schema),
      catch: (err) =>
        new CliError({
          message: `${contract.label}: ${err instanceof Error ? err.message : String(err)}`,
        }),
    });

    const violations = validateTableAgainstSchema(prepared.columns, prepared.rows, schema);
    if (violations.length > 0) {
      return yield* Effect.fail(
        new CliError({
          message: formatTableSchemaViolations(contract.schema, violations),
        })
      );
    }
    logger.info(`OK ${contract.schema}`);
  }
  return 0;
});

if (import.meta.main) {
  const exitCode = await runCliExit(program, { toolName: TOOL, logger });
  process.exit(exitCode);
}
