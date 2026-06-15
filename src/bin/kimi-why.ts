#!/usr/bin/env bun
/**
 * kimi-why — explain and record toolchain decisions.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { explainDecision, recordDecision } from "../lib/decision-ledger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-why");

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  logger.line("Usage: kimi-why <topic> [--json]");
  logger.line(
    "       kimi-why record <key> --action <text> --trigger <text> --reason <text> --outcome <text>"
  );
}

function argValue(flag: string): string | null {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return null;
  return Bun.argv[index + 1] ?? null;
}

function argValues(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < Bun.argv.length; index++) {
    if (Bun.argv[index] === flag && Bun.argv[index + 1]) values.push(Bun.argv[index + 1]);
  }
  return values;
}

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "record") {
    const key = args[1];
    if (!key) throw new CliError({ message: "Usage: kimi-why record <key> ..." });
    const action = argValue("--action");
    const trigger = argValue("--trigger");
    const reasoning = argValue("--reason") ?? argValue("--reasoning");
    const outcome = argValue("--outcome");
    if (!action || !trigger || !reasoning || !outcome) {
      throw new CliError({
        message: "record requires --action, --trigger, --reason, and --outcome",
      });
    }
    const record = recordDecision({
      key,
      action,
      trigger,
      reasoning,
      outcome,
      alternatives: argValues("--alternative"),
    });
    if (json) emitJson(record);
    else logger.info(`recorded ${record.id} for ${key}`);
    return 0;
  }

  const topic = args.filter((arg) => !arg.startsWith("--")).join(" ");
  const explanation = await explainDecision(topic);
  if (json) {
    emitJson(explanation);
    return explanation.matches.length > 0 ? 0 : 1;
  }

  logger.banner("Kimi Why");
  if (!explanation.latest) {
    logger.warn(`No decision found for ${topic}`);
    return 1;
  }
  const latest = explanation.latest;
  logger.info(`${latest.key}: ${latest.action}`);
  logger.info(`trigger: ${latest.trigger}`);
  logger.info(`reason: ${latest.reasoning}`);
  logger.info(`outcome: ${latest.outcome}`);
  if (latest.alternatives.length > 0) {
    logger.info(`alternatives: ${latest.alternatives.join("; ")}`);
  }
  if (latest.traceId) logger.info(`trace: ${latest.traceId}`);
  return 0;
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      e instanceof CliError
        ? e
        : new CliError({ message: e instanceof Error ? e.message : String(e) }),
  }),
  { toolName: "kimi-why", logger }
);
process.exit(exitCode);
