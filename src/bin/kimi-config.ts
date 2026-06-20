#!/usr/bin/env bun
/**
 * kimi-config — Config lifecycle for build-time [define] constants.
 *
 * Canary and A/B are proposal-only validation workflows. They do not route
 * traffic or mutate bunfig.toml unless a later apply command is approved.
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import {
  applyLifecycleProposal,
  buildConfigDiffReport,
  buildConfigTimeline,
  createAbProposalEffect,
  createCanaryProposalEffect,
  parseProposedConstantValue,
  rollbackLifecycleChange,
  validateConfigConstants,
  watchLifecycleProposal,
} from "../lib/config-lifecycle.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-config");

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

async function writeJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.section("kimi-config commands");
  logger.line("  diff --from golden --to current --impact [--json]");
  logger.line("  validate [--json]");
  logger.line("  timeline --constant <KIMI_KEY> [--json]");
  logger.line("  canary --constant <KIMI_KEY> --value <value> --percent <n> [--json]");
  logger.line("  ab --constant <KIMI_KEY> --a <value> --b <value> --duration <window> [--json]");
  logger.line("  apply <proposal-id> --yes [--message <text>] [--json]");
  logger.line("  rollback <record-id|decision-id> --yes [--json]");
  logger.line(
    "  watch --auto-rollback [--proposal <id>] [--threshold <n>] [--dry-run|--yes] [--json]"
  );
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] ?? "help";
  const jsonMode = hasFlag("--json");
  const projectRoot = await resolveDecisionsRoot();

  if (command === "diff") {
    const report = await buildConfigDiffReport(projectRoot);
    if (jsonMode) {
      await writeJson(report);
    } else {
      const count = report.diff.missingKeys.length + report.diff.invalidKeys.length;
      logger.section("Config Diff");
      logger.info(`Golden: ${report.goldenVersion}`);
      logger.info(`${count} drifted constant(s)`);
      for (const key of report.diff.missingKeys) logger.line(`  missing ${key}`);
      for (const invalid of report.diff.invalidKeys) {
        logger.line(`  ${invalid.key}: ${String(invalid.actual)} -> ${String(invalid.expected)}`);
      }
      logger.info(`Next: ${report.suggestedNextCommand}`);
    }
    return 0;
  }

  if (command === "validate") {
    const report = await validateConfigConstants(projectRoot);
    if (jsonMode) {
      await writeJson(report);
    } else {
      logger.section("Config Validate");
      logger.info(
        `${report.constants.length} constant(s), ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`
      );
      for (const item of report.issues) {
        const prefix = item.severity === "error" ? "error" : "warn";
        logger.line(`  ${prefix} ${item.key}: ${item.message}`);
      }
      if (report.issues.length === 0) logger.info("All constants valid");
    }
    return report.summary.ok ? 0 : 1;
  }

  if (command === "timeline") {
    const constant = argValue("--constant");
    if (!constant) {
      logger.error("Usage: timeline --constant <KIMI_KEY> [--json]");
      return 1;
    }
    const report = await buildConfigTimeline(projectRoot, constant);
    if (jsonMode) {
      await writeJson(report);
    } else {
      logger.section("Config Timeline");
      logger.info(`${constant}: ${report.events.length} event(s)`);
      for (const event of report.events) {
        logger.line(
          `  ${event.timestamp.slice(0, 10)} ${event.source}:${event.type} ${event.id} — ${event.summary}`
        );
      }
    }
    return 0;
  }

  if (command === "canary") {
    const constant = argValue("--constant");
    const rawValue = argValue("--value");
    const percentRaw = argValue("--percent");
    if (!constant || rawValue === undefined || !percentRaw) {
      logger.error("Usage: canary --constant <KIMI_KEY> --value <value> --percent <n> [--json]");
      return 1;
    }
    const percent = Number(percentRaw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      logger.error("--percent must be a number in (0, 100]");
      return 1;
    }
    const value = await parseProposedConstantValue(projectRoot, constant, rawValue);
    const result = await Effect.runPromise(
      createCanaryProposalEffect({
        projectRoot,
        constant,
        value,
        percent,
        suite: argValue("--suite"),
        message: argValue("--message"),
      })
    );
    if (jsonMode) {
      await writeJson(result);
    } else {
      logger.section("Config Canary");
      logger.info(`${result.record.id}: ${result.record.status}`);
      logger.info(`Intent only: ${constant}=${String(value)} at ${percent}%`);
      logger.info(`Recommendation: ${result.recommendation}`);
    }
    return result.record.status === "failed" ? 1 : 0;
  }

  if (command === "ab") {
    const constant = argValue("--constant");
    const rawA = argValue("--a");
    const rawB = argValue("--b");
    const duration = argValue("--duration");
    if (!constant || rawA === undefined || rawB === undefined || !duration) {
      logger.error(
        "Usage: ab --constant <KIMI_KEY> --a <value> --b <value> --duration <window> [--json]"
      );
      return 1;
    }
    const [a, b] = await Promise.all([
      parseProposedConstantValue(projectRoot, constant, rawA),
      parseProposedConstantValue(projectRoot, constant, rawB),
    ]);
    const result = await Effect.runPromise(
      createAbProposalEffect({
        projectRoot,
        constant,
        a,
        b,
        duration,
        suite: argValue("--suite"),
      })
    );
    if (jsonMode) {
      await writeJson(result);
    } else {
      logger.section("Config A/B");
      logger.info(`${result.record.id}: ${result.record.status}`);
      for (const variant of result.variants) {
        logger.line(
          `  ${variant.name}: ${String(variant.value)} ${variant.passed ? "passed" : "failed"}`
        );
      }
      logger.info(`Recommendation: ${result.recommendation}`);
    }
    return result.record.status === "failed" ? 1 : 0;
  }

  if (command === "apply") {
    const proposalId = args[1];
    if (!proposalId || !hasFlag("--yes")) {
      logger.error("Usage: apply <proposal-id> --yes [--message <text>] [--json]");
      return 1;
    }
    const record = await applyLifecycleProposal({
      projectRoot,
      proposalId,
      message: argValue("--message"),
      allowDirtyBunfig: hasFlag("--allow-dirty-bunfig"),
    });
    if (jsonMode) {
      await writeJson({ schemaVersion: record.schemaVersion, record });
    } else {
      logger.section("Config Apply");
      logger.info(
        `${record.constant}: ${String(record.values.previous)} -> ${String(record.values.applied)}`
      );
      logger.info(`Decision: ${record.decisionId}`);
    }
    return 0;
  }

  if (command === "rollback") {
    const id = args[1];
    if (!id || !hasFlag("--yes")) {
      logger.error("Usage: rollback <record-id|decision-id> --yes [--json]");
      return 1;
    }
    const record = await rollbackLifecycleChange({
      projectRoot,
      id,
      allowDirtyBunfig: hasFlag("--allow-dirty-bunfig"),
    });
    if (jsonMode) {
      await writeJson({ schemaVersion: record.schemaVersion, record });
    } else {
      logger.section("Config Rollback");
      logger.info(`${record.constant}: restored ${String(record.values.restored)}`);
      logger.info(`Decision: ${record.decisionId}`);
    }
    return 0;
  }

  if (command === "watch") {
    if (!hasFlag("--auto-rollback")) {
      logger.error(
        "Usage: watch --auto-rollback [--proposal <id>] [--threshold <n>] [--dry-run|--yes] [--json]"
      );
      return 1;
    }
    const threshold = Number(argValue("--threshold") ?? "15");
    const report = await watchLifecycleProposal({
      projectRoot,
      proposalId: argValue("--proposal"),
      threshold: Number.isFinite(threshold) ? threshold : 15,
      dryRun: hasFlag("--dry-run") || !hasFlag("--yes"),
      applyRollback: hasFlag("--yes"),
    });
    if (jsonMode) {
      await writeJson(report);
    } else {
      logger.section("Config Watch");
      logger.info(`Status: ${report.status}`);
      if (report.scoreDrop !== undefined) logger.info(`Score drop: ${report.scoreDrop}`);
      if (report.rollbackCommand) logger.warn(report.rollbackCommand);
    }
    return report.status === "rolled-back" ||
      report.status === "healthy" ||
      report.status === "rollback-recommended"
      ? 0
      : 1;
  }

  printHelp();
  return command === "help" || command === "--help" || command === "-h" ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-config", logger }
  );
  process.exit(exitCode);
}
