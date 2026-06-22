#!/usr/bin/env bun
/**
 * kimi-error — semantic failure clustering and suggestions.
 *
 * Usage:
 *   kimi-error cluster [--json] [--threshold <0..1>]
 *   kimi-error suggest <error-id> [--json]
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import {
  clusterFailureLedgerEffect,
  suggestForErrorEffect,
  type ClusterSummary,
} from "../lib/error-clustering.ts";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { parseCliFlags, writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-error");

async function emitJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-error <cluster|suggest> [args] [--json] [--threshold <0..1>]");
  logger.line("");
  logger.line("Examples:");
  logger.line("  kimi-error cluster --json");
  logger.line("  kimi-error suggest error-abc123 --json");
}

function argValue(flag: string): string | null {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return null;
  return Bun.argv[index + 1] ?? null;
}

function threshold(): number | undefined {
  const raw = argValue("--threshold");
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return undefined;
  return parsed;
}

function printClusterTable(summaries: ClusterSummary[]): void {
  logger.banner("Error Clusters");
  if (summaries.length === 0) {
    logger.warn("No failure ledger records found.");
    return;
  }
  const header = "CLUSTER".padEnd(22) + "COUNT".padEnd(7) + "TAXONOMY".padEnd(16) + "PLAYBOOK";
  logger.line(header);
  logger.line("-".repeat(header.length));
  for (const row of summaries) {
    const playbook = row.hasPlaybook ? "yes" : "no";
    const taxonomy = row.topTaxonomy ?? "—";
    logger.line(
      `${row.clusterId.slice(0, 20).padEnd(22)}${String(row.count).padEnd(7)}${taxonomy.padEnd(16)}${playbook}`
    );
    logger.line(`  ${row.representativeError.summary.slice(0, 72)}`);
    if (row.representativeError.traceId) {
      logger.line(`  trace: ${row.representativeError.traceId}`);
    }
  }
}

async function main(): Promise<number> {
  const { json } = parseCliFlags(Bun.argv, "kimi-error");
  const argv = Bun.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("--"));

  if (!command || command === "help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "cluster") {
    const report = await Effect.runPromise(clusterFailureLedgerEffect({ threshold: threshold() }));
    if (json) await emitJson(report.summaries);
    else printClusterTable(report.summaries);
    return 0;
  }

  if (command === "suggest") {
    const errorId = argv[argv.indexOf("suggest") + 1];
    if (!errorId || errorId.startsWith("--")) {
      throw new CliError({ message: "Usage: kimi-error suggest <error-id>" });
    }
    const suggestion = await Effect.runPromise(
      suggestForErrorEffect(errorId, { threshold: threshold() })
    );
    if (!suggestion) throw new CliError({ message: `Error not found: ${errorId}` });
    if (json) await emitJson(suggestion);
    else {
      logger.info(`cluster: ${suggestion.clusterId ?? "none"}`);
      logger.info(`confidence: ${Math.round(suggestion.confidence * 100)}%`);
      logger.info(suggestion.recommendation);
      if (suggestion.playbook?.command) {
        logger.info(`command: ${suggestion.playbook.command.join(" ")}`);
      }
      if (suggestion.similarErrors.length > 0) {
        logger.line("similar:");
        for (const item of suggestion.similarErrors) {
          logger.line(`  - ${item.output.slice(0, 80)}`);
        }
      }
    }
    return 0;
  }

  throw new CliError({ message: `Unknown error command: ${command}` });
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        e instanceof CliError
          ? e
          : new CliError({ message: e instanceof Error ? e.message : String(e) }),
    }),
    { toolName: "kimi-error", logger }
  );
  process.exit(exitCode);
}
