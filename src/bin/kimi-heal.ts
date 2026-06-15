#!/usr/bin/env bun
/**
 * kimi-heal — failure clustering and local healing hints.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { clusterFailureLedger, matchErrorToClusters } from "../lib/error-clustering.ts";
import {
  applyHealPlan,
  buildHealPlan,
  type HealApplyReport,
  type HealPlan,
} from "../lib/self-healing.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveProjectRoot } from "../lib/utils.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  logger.line(
    "Usage: kimi-heal <plan|apply|clusters|match> [text] [--json] [--threshold <0..1>] [--yes]"
  );
  logger.line("");
  logger.line("Examples:");
  logger.line("  kimi-heal plan --json");
  logger.line("  kimi-heal apply --dry-run");
  logger.line("  kimi-heal apply --yes --action capability:mcp-config:doctor-fix");
  logger.line("  kimi-heal clusters --json");
  logger.line('  kimi-heal match "Tool timed out after 30000ms"');
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

function argValues(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < Bun.argv.length; index++) {
    if (Bun.argv[index] === flag && Bun.argv[index + 1]) values.push(Bun.argv[index + 1]);
  }
  return values;
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

  if (command === "apply") {
    const projectRoot = await resolveProjectRoot();
    const plan = await buildHealPlan(projectRoot, { threshold: threshold() });
    const report = await applyHealPlan(plan, {
      projectRoot,
      yes: Bun.argv.includes("--yes"),
      dryRun: Bun.argv.includes("--dry-run") || !Bun.argv.includes("--yes"),
      actionIds: argValues("--action"),
    });
    if (json) emitJson(report);
    else printApplyReport(report);
    return report.summary.failed > 0 ? 1 : 0;
  }

  if (command === "clusters") {
    const report = await clusterFailureLedger({ threshold: threshold() });
    if (json) emitJson(report);
    else printClusters(report);
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
        `${match.cluster.id}: ${match.cluster.label} (${Math.round(match.confidence * 100)}% confidence)`
      );
      if (match.cluster.suggestedFix) logger.info(match.cluster.suggestedFix);
      if (match.cluster.autoFix) logger.info(`autoFix: ${match.cluster.autoFix}`);
    } else {
      logger.warn("No similar cluster found");
    }
    return 0;
  }

  throw new CliError({ message: `Unknown heal command: ${command}` });
}

function printClusters(report: Awaited<ReturnType<typeof clusterFailureLedger>>): void {
  logger.banner("Kimi Heal");
  if (report.clusters.length === 0) {
    logger.warn("No failure ledger records found.");
    return;
  }
  for (const cluster of report.clusters) {
    logger.info(
      `${cluster.id}: ${cluster.label} — ${cluster.size} failure(s), ${Math.round(cluster.confidence * 100)}% confidence`
    );
    if (cluster.suggestedFix) logger.line(`    fix: ${cluster.suggestedFix}`);
    if (cluster.autoFix) logger.line(`    autoFix: ${cluster.autoFix}`);
  }
}

function printPlan(plan: HealPlan): void {
  logger.banner("Kimi Heal Plan");
  if (plan.actions.length === 0) {
    logger.info("No healing actions surfaced.");
    return;
  }
  logger.info(
    `${plan.summary.autoApplicable} safe auto-apply, ${plan.summary.manual} manual, ${plan.summary.blocked} blocked`
  );
  for (const action of plan.actions) {
    const mode =
      action.status === "blocked" ? "blocked" : action.safeToAutoApply ? "auto" : "manual";
    logger.line(
      `  [${mode}] ${action.id}: ${action.title} (${Math.round(action.confidence * 100)}%)`
    );
    logger.line(`      ${action.reason}`);
    if (action.command) logger.line(`      command: ${action.command.join(" ")}`);
  }
}

function printApplyReport(report: HealApplyReport): void {
  logger.banner(report.dryRun ? "Kimi Heal Apply — Dry Run" : "Kimi Heal Apply");
  if (report.applied.length === 0) {
    logger.info("No selected actions.");
    return;
  }
  for (const item of report.applied) {
    logger.line(`  [${item.status}] ${item.id}: ${item.title}`);
    if (item.command) logger.line(`      command: ${item.command.join(" ")}`);
    if (item.reason) logger.line(`      ${item.reason}`);
    if (typeof item.exitCode === "number") logger.line(`      exitCode: ${item.exitCode}`);
  }
  logger.info(
    `${report.summary.applied} applied, ${report.summary.failed} failed, ${report.summary.skipped} skipped`
  );
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
