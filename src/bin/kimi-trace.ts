#!/usr/bin/env bun
/**
 * kimi-trace — reconstruct a causal trace graph from local ledgers.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { buildTraceGraph, renderTraceTree } from "../lib/trace-ledger.ts";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-trace");

async function emitJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-trace <trace-id> [--json]");
  logger.line("");
  logger.line("Examples:");
  logger.line("  kimi-trace 018f...");
  logger.line("  kimi-toolchain trace 018f... --json");
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2).filter((arg) => arg !== "--json");
  const json = Bun.argv.includes("--json");
  const traceId = args[0];

  if (!traceId || traceId === "--help" || traceId === "-h") {
    printHelp();
    return traceId ? 0 : 1;
  }

  const graph = await buildTraceGraph(traceId);
  if (json) {
    await emitJson(graph);
    return graph.found ? 0 : 1;
  }

  logger.banner("Kimi Trace");
  logger.line(renderTraceTree(graph));
  return graph.found ? 0 : 1;
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-trace", logger }
  );
  process.exit(exitCode);
}
