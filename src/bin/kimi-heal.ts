#!/usr/bin/env bun
/**
 * kimi-heal — failure clustering and local healing hints.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { clusterFailureLedger, matchErrorToClusters } from "../lib/error-clustering.ts";
import { buildHealPlan, type HealPlan } from "../lib/self-healing.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveProjectRoot } from "../lib/utils.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  logger.line("Usage: kimi-heal <plan|clusters|match> [text] [--json] [--threshold <0..1>]");
  logger.line("");
  logger.line("Examples:");
  logger.line("  kimi-heal plan --json");
  logger.line("  kimi-heal clusters --json");
  logger.line('  kimi-heal match "Tool timed out after 30000ms"');
  logger.line("");
  logger.line("For clustering output, prefer: kimi-error cluster --json");
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

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const argv = Bun.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("--"));

  if (!command || command === "help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "plan") {
    const plan = await buildHealPlan(await resolveProjectRoot(), { threshold: threshold() });
    if (json) emitJson(plan);
    else printPlan(plan);
    return 0;
  }

  if (command === "clusters") {
    const report = await clusterFailureLedger({ threshold: threshold() });
    if (json) emitJson(report.summaries);
    else {
      logger.banner("Kimi Heal Clusters");
      for (const row of report.summaries) {
        logger.info(`${row.clusterId}: ${row.count} failure(s), playbook=${row.hasPlaybook}`);
      }
    }
    return 0;
  }

  if (command === "match") {
    const textIndex = argv.indexOf("match") + 1;
    const text = argv
      .slice(textIndex)
      .filter((arg) => !arg.startsWith("--") && arg !== argValue("--threshold"))
      .join(" ")
      .trim();
    if (!text) throw new CliError({ message: "Usage: kimi-heal match <error-text>" });
    const report = await clusterFailureLedger({ threshold: threshold() });
    const match = matchErrorToClusters(text, report.clusters);
    if (json) emitJson({ query: text, match });
    else if (match) {
      logger.info(
        `${match.cluster.id}: ${match.cluster.label} (${Math.round(match.confidence * 100)}%)`
      );
      if (match.cluster.suggestedFix) logger.info(match.cluster.suggestedFix);
    } else {
      logger.warn("No similar cluster found");
    }
    return 0;
  }

  throw new CliError({ message: `Unknown heal command: ${command}` });
}

function printPlan(plan: HealPlan): void {
  logger.banner("Kimi Heal Plan");
  if (plan.actions.length === 0) {
    logger.info("No healing actions surfaced.");
    return;
  }
  logger.info(
    `${plan.summary.autoApplicable} auto, ${plan.summary.manual} manual, ${plan.summary.blocked} blocked`
  );
  for (const action of plan.actions) {
    const mode = action.safeToAutoApply ? "auto" : action.status;
    logger.line(`  [${mode}] ${action.id}: ${action.title}`);
    logger.line(`      ${action.reason}`);
    if (action.command) logger.line(`      command: ${action.command.join(" ")}`);
  }
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      e instanceof CliError
        ? e
        : new CliError({ message: e instanceof Error ? e.message : String(e) }),
  }),
  { toolName: "kimi-heal", logger }
);
process.exit(exitCode);
