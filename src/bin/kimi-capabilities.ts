#!/usr/bin/env bun
/**
 * kimi-capabilities — live readiness probe across local integrations.
 */

import { Effect } from "effect";
import {
  capabilityReport,
  readCapabilityTrend,
  type CapabilityStatus,
} from "../lib/capabilities.ts";
import { createLogger } from "../lib/logger.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-capabilities");

async function emitJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-capabilities [--json] [--trend]");
}

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const trend = Bun.argv.includes("--trend");
  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    printHelp();
    return 0;
  }

  if (trend) {
    const report = await readCapabilityTrend();
    if (json) await emitJson(report);
    else {
      logger.banner("Kimi Capabilities Trend");
      for (const snapshot of report.snapshots) {
        logger.info(
          `${snapshot.generatedAt}: ${snapshot.readinessScore}% (${snapshot.healthy}/${snapshot.checks.length} healthy)`
        );
      }
    }
    return 0;
  }

  const projectRoot = await resolveProjectRoot();
  const report = await capabilityReport(projectRoot);
  if (json) {
    await emitJson(report);
    return report.unavailable > 0 ? 1 : 0;
  }

  logger.banner("Kimi Capabilities");
  for (const check of report.checks) {
    const last = check.lastSuccessfulContact ? `; last healthy ${check.lastSuccessfulContact}` : "";
    logger.line(
      `  ${statusIcon(check.status)} ${check.id}: ${check.summary} (${check.latencyMs}ms${last})`
    );
  }
  logger.info(`Readiness: ${report.readinessScore}%`);
  return report.unavailable > 0 ? 1 : 0;
}

function statusIcon(status: CapabilityStatus): string {
  if (status === "healthy") return "✅";
  if (status === "degraded") return "⚠️";
  return "❌";
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      new CliError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }),
  { toolName: "kimi-capabilities", logger }
);
process.exit(exitCode);
