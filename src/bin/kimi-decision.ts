#!/usr/bin/env bun
/**
 * kimi-decision — query and record toolchain decision rationale.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import {
  decisionAlternativeActions,
  decisionOutcomeResult,
  decisionRationaleText,
  decisionTriggerSummary,
  explainDecision,
  persistDecisionQualityScores,
  queryDecisionLedger,
  recordDecision,
  suggestDecisions,
  type DecisionQueryFilters,
  type DecisionRecord,
} from "../lib/decision-ledger.ts";
import { buildDecisionGraph, renderDecisionGraphAscii } from "../lib/decision-graph.ts";
import { scoreDecisions } from "../lib/decision-scoring.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-decision");

async function emitJson(value: unknown): Promise<void> {
  await Bun.write(Bun.stdout, `${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  logger.line("Usage: kimi-decision <log|why|record|graph|suggest|score> [options]");
  logger.line("       kimi-why <decision-id|topic> [--json]");
  logger.line("");
  logger.line("Commands:");
  logger.line("  log                      List recent decisions");
  logger.line("  why <decision-id|topic>  Explain one decision with trace/root-cause context");
  logger.line("  record <key>             Append a decision record");
  logger.line("  graph <trace|decision>   Render decision DAG");
  logger.line("  suggest                  Recommend high-quality prior decisions");
  logger.line("  score                    Recompute quality scores");
  logger.line("");
  logger.line("Options:");
  logger.line("  --json                   Machine-readable output");
  logger.line("  --limit <n>              Limit log output");
  logger.line("  --action <name>          Filter log output by action");
  logger.line("  --cluster <id>           Filter log output by error cluster");
  logger.line("  --since <iso-date>       Filter log output by timestamp");
}

function argValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function argValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function nonFlagArgs(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (args[index + 1] && !args[index + 1].startsWith("--")) index++;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function filtersFromArgs(args: string[]): DecisionQueryFilters {
  const limitRaw = argValue(args, "--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const action = argValue(args, "--action");
  const cluster = argValue(args, "--cluster");
  const since = argValue(args, "--since");
  return {
    ...(Number.isFinite(limit) && limit! > 0 ? { limit } : {}),
    ...(action ? { action } : {}),
    ...(cluster ? { cluster } : {}),
    ...(since ? { since } : {}),
  };
}

export async function runDecisionCli(args: string[] = Bun.argv.slice(2)): Promise<number> {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const positional = nonFlagArgs(args);
  const command = positional[0];

  if (!command || command === "help") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "log" || command === "list") {
    const records = await queryDecisionLedger(filtersFromArgs(args));
    if (json) {
      await emitJson({ schemaVersion: 1, decisions: records });
    } else {
      printDecisionLog(records);
    }
    return 0;
  }

  if (command === "record") {
    const key = positional[1];
    if (!key) throw new CliError({ message: "Usage: kimi-decision record <key> ..." });
    const action = argValue(args, "--action");
    const trigger = argValue(args, "--trigger");
    const rationale = argValue(args, "--rationale") ?? argValue(args, "--reason");
    const outcome = argValue(args, "--outcome");
    if (!action || !trigger || !rationale || !outcome) {
      throw new CliError({
        message: "record requires --action, --trigger, --rationale/--reason, and --outcome",
      });
    }
    const record = await recordDecision({
      key,
      actor: argValue(args, "--actor") ?? "kimi",
      action,
      trigger,
      clusterId: argValue(args, "--cluster") ?? undefined,
      rationale,
      alternativesConsidered: argValues(args, "--alternative"),
      outcome,
      parentDecisionId: argValue(args, "--parent-decision") ?? undefined,
    });
    if (json) await emitJson(record);
    else logger.info(`recorded ${record.decisionId} for ${key}`);
    return 0;
  }

  if (command === "graph") {
    const target = positional[1];
    if (!target)
      throw new CliError({ message: "Usage: kimi-decision graph <trace-id|decision-id>" });
    const graph = await buildDecisionGraph(target);
    if (json) {
      await emitJson(graph);
    } else {
      logger.line(renderDecisionGraphAscii(graph));
    }
    return graph.found ? 0 : 1;
  }

  if (command === "suggest") {
    const suggestions = await suggestDecisions({
      clusterId: argValue(args, "--cluster") ?? undefined,
      action: argValue(args, "--action") ?? undefined,
      limit: Number(argValue(args, "--limit") ?? "5"),
    });
    if (json) {
      await emitJson({ schemaVersion: 1, suggestions });
    } else {
      printSuggestedDecisions(suggestions);
    }
    return suggestions.length > 0 ? 0 : 1;
  }

  if (command === "score") {
    const since = argValue(args, "--since");
    const all = await queryDecisionLedger();
    const candidates =
      since && Number.isFinite(Date.parse(since))
        ? all.filter((record) => Date.parse(record.timestamp) >= Date.parse(since))
        : all;
    const updates = await scoreDecisions(candidates);
    const persisted = await persistDecisionQualityScores(updates);
    const payload = {
      schemaVersion: 1,
      scored: updates.size,
      updated: persisted.updated,
      total: persisted.total,
      since: since ?? null,
    };
    if (json) {
      await emitJson(payload);
    } else {
      logger.info(
        `scored ${payload.scored} decisions (updated ${payload.updated}/${payload.total})${since ? ` since ${since}` : ""}`
      );
    }
    return 0;
  }

  const query = command === "why" ? positional.slice(1).join(" ") : positional.join(" ");
  if (!query.trim()) throw new CliError({ message: "Usage: kimi-decision why <decision-id>" });
  const explanation = await explainDecision(query.trim());
  if (json) {
    await emitJson(explanation);
    return explanation.matches.length > 0 ? 0 : 1;
  }

  printDecisionWhy(query.trim(), explanation.latest, explanation.rootCauseChain);
  return explanation.latest ? 0 : 1;
}

function printDecisionLog(records: DecisionRecord[]): void {
  logger.banner("Kimi Decision Log");
  if (records.length === 0) {
    logger.info("No decisions recorded.");
    return;
  }
  for (const record of records) {
    const cluster = record.clusterId ? ` cluster=${record.clusterId}` : "";
    logger.line(
      `  ${record.timestamp} ${record.decisionId} [${record.actor}] ${record.action}${cluster}`
    );
    logger.line(`      ${decisionRationaleText(record)}`);
  }
}

function printSuggestedDecisions(records: DecisionRecord[]): void {
  logger.banner("Kimi Decision Suggestions");
  if (records.length === 0) {
    logger.info("No high-quality suggestions found.");
    return;
  }
  for (const record of records) {
    const score = record.qualityScore === undefined ? "n/a" : record.qualityScore.toFixed(2);
    logger.line(`  ${record.decisionId} score=${score} action=${record.action}`);
    logger.line(`      trigger: ${decisionTriggerSummary(record)}`);
    logger.line(`      rationale: ${decisionRationaleText(record)}`);
    const alternatives = decisionAlternativeActions(record);
    if (alternatives.length > 0) {
      logger.line(`      alternatives: ${alternatives.join("; ")}`);
    }
  }
}

function printDecisionWhy(
  query: string,
  record: DecisionRecord | undefined,
  rootCauseChain: readonly string[]
): void {
  logger.banner("Kimi Why");
  if (!record) {
    logger.warn(`No decision found for ${query}`);
    return;
  }
  logger.info(`${record.decisionId}: ${record.action}`);
  logger.info(`actor: ${record.actor}`);
  logger.info(`trigger: ${decisionTriggerSummary(record)}`);
  if (record.clusterId) logger.info(`cluster: ${record.clusterId}`);
  logger.info(`rationale: ${decisionRationaleText(record)}`);
  logger.info(`outcome: ${decisionOutcomeResult(record)}`);
  if (record.alternativesConsidered.length > 0) {
    logger.info(`alternatives: ${record.alternativesConsidered.join("; ")}`);
  }
  if (record.traceId) logger.info(`trace: ${record.traceId}`);
  if (rootCauseChain.length > 0) logger.info(`root cause chain: ${rootCauseChain.join(" -> ")}`);
  if (record.childDecisionIds.length > 0) {
    logger.info(`follow-ups: ${record.childDecisionIds.join(", ")}`);
  }
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => runDecisionCli(),
      catch: (e) =>
        e instanceof CliError
          ? e
          : new CliError({ message: e instanceof Error ? e.message : String(e) }),
    }),
    { toolName: "kimi-decision", logger }
  );
  process.exit(exitCode);
}
