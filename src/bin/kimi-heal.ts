#!/usr/bin/env bun
/**
 * kimi-heal — Self-healing with decision ledger integration
 *
 * Usage:
 *   kimi-heal plan [--json]
 *   kimi-heal apply --action <id> [--dry-run] [--yes] [--json]
 *   kimi-heal repair-constants [--all] [--impact] [--accept-drift] [--dry-run|--yes] [--json]
 *   kimi-heal suggest --error-id <id> [--json]
 *   kimi-heal constants snapshot [--json]
 *   kimi-heal constants optimize [--apply <keys|all>] [--min-confidence 0.7] [--dry-run|--yes] [--json]
 *   kimi-heal effect audit [--check-tags] [--event-streams] [--json]
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { createCli } from "../lib/cli-contract.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import { applyHealAction, buildHealPlanEffect } from "../lib/self-healing.ts";
import { clusterFailureLedgerEffect } from "../lib/error-clustering.ts";
import { ensureProcessTrace } from "../lib/effect/trace-context.ts";
import {
  buildConstantRepairPlan,
  repairConstants,
  writeConstantsGolden,
  listGoldenArchives,
  restoreGoldenFromArchive,
  acceptConstantsDrift,
} from "../lib/constants-heal.ts";
import {
  formatErrorSuggestReport,
  suggestErrorWithBoundConstantsEffect,
} from "../lib/error-suggest.ts";
import {
  applyOptimizerRecommendationsEffect,
  buildConstantOptimizerReport,
  formatConstantOptimizerReport,
  formatOptimizerApplyResultLines,
  generateOptimizerDoctorRecommendationsEffect,
  optimizerRecommendationsToJson,
  printConstantOptimizerRecommendationsBlock,
} from "../lib/constant-optimizer.ts";
import { buildEffectGatesReport } from "../lib/effect-gates.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

function argList(flag: string): string[] {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return [];
  const values: string[] = [];
  for (let i = index + 1; i < Bun.argv.length; i++) {
    const value = Bun.argv[i];
    if (!value || value.startsWith("--")) break;
    values.push(...value.split(","));
  }
  return values.map((item) => item.trim()).filter(Boolean);
}

function numericArg(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function impactRiskLabel(activeFailures: number, risk: string): string {
  if (activeFailures === 0) return `${risk} (no active failures in window)`;
  return `${risk} (${activeFailures} active failure${activeFailures === 1 ? "" : "s"} in window)`;
}

function renderRepairPreview(result: Awaited<ReturnType<typeof repairConstants>>): string[] {
  const impactByKey = new Map((result.impact ?? []).map((impact) => [impact.key, impact]));
  const lines: string[] = [];

  for (const item of result.plan.diff.invalidKeys) {
    const impact = impactByKey.get(item.key);
    lines.push(`Would restore ${item.key}: ${String(item.actual)}→${String(item.expected)}`);
    if (impact) {
      lines.push(`  Bound taxonomies: ${impact.boundTaxonomies.join(", ") || "none"}`);
      lines.push(`  Services affected: ${impact.servicesAffected.join(", ") || "none"}`);
      lines.push(
        `  Estimated risk: ${impactRiskLabel(impact.activeFailures, impact.estimatedRisk)}`
      );
    }
  }

  for (const key of result.plan.diff.missingKeys) {
    const impact = impactByKey.get(key);
    lines.push(`Would restore ${key}: (missing)→golden`);
    if (impact) {
      lines.push(`  Bound taxonomies: ${impact.boundTaxonomies.join(", ") || "none"}`);
      lines.push(`  Services affected: ${impact.servicesAffected.join(", ") || "none"}`);
      lines.push(
        `  Estimated risk: ${impactRiskLabel(impact.activeFailures, impact.estimatedRisk)}`
      );
    }
  }

  return lines;
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] ?? "plan";
  const jsonMode = hasFlag("--json");
  const projectRoot = await resolveDecisionsRoot();
  const trace = ensureProcessTrace();

  if (command === "plan") {
    const plan = await Effect.runPromise(
      buildHealPlanEffect({ projectRoot, traceId: trace.traceId })
    );
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      logger.section("Heal Plan");
      logger.info(`Trace: ${plan.traceId}`);
      if (plan.skippedDecisionIds.length > 0) {
        logger.warn(`Skipping ${plan.skippedDecisionIds.length} low-quality past decision(s)`);
      }
      if (plan.actions.length === 0) {
        logger.info("No auto-applicable heal actions found");
      } else {
        for (const action of plan.actions) {
          const safe = action.safeToAutoApply ? "safe" : "manual";
          logger.line(`  [${safe}] ${action.id} — ${action.playbookId}: ${action.description}`);
        }
      }
    }
    return 0;
  }

  if (command === "apply") {
    const actionId = argValue("--action");
    const dryRun = hasFlag("--dry-run") || !hasFlag("--yes");
    if (!actionId) {
      logger.error("Usage: apply --action <id> [--dry-run] [--yes] [--json]");
      return 1;
    }
    const plan = await Effect.runPromise(
      buildHealPlanEffect({ projectRoot, traceId: trace.traceId })
    );
    const action = plan.actions.find((item) => item.id === actionId);
    if (!action) {
      logger.error(`Unknown action: ${actionId}. Run 'kimi-heal plan' first.`);
      return 1;
    }
    if (!action.safeToAutoApply && !hasFlag("--yes")) {
      logger.error(`Action ${actionId} requires manual approval — pass --yes`);
      return 1;
    }

    const result = await applyHealAction({
      actionId: action.id,
      playbookId: action.playbookId,
      dryRun,
      clusterId: action.clusterId,
      clusterConfidence: action.clusterConfidence,
      errorId: action.errorId,
      traceId: trace.traceId,
      execute:
        action.playbookId.includes("sync") && !dryRun
          ? async () => {
              const proc = Bun.spawn(["bun", "run", "sync"], {
                cwd: projectRoot,
                stdout: "pipe",
                stderr: "pipe",
              });
              const code = await proc.exited;
              return {
                success: code === 0,
                detail: code === 0 ? "bun run sync completed" : `sync exited ${code}`,
              };
            }
          : undefined,
    });

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      logger.section("Heal Apply");
      logger.info(`Decision: ${result.decision.decisionId}`);
      logger.info(result.detail);
      logger.info(`Run 'kimi-decision why ${result.decision.decisionId}' for full rationale`);
    }
    return result.success ? 0 : 1;
  }

  if (command === "clusters") {
    const report = await Effect.runPromise(clusterFailureLedgerEffect({ persist: true }));
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      logger.section("Error Clusters");
      logger.info(`${report.clusters.length} cluster(s), ${report.totalFailures} failure(s)`);
      for (const cluster of report.clusters.slice(0, 10)) {
        logger.line(
          `  ${cluster.clusterId} count=${cluster.count} taxonomy=${cluster.topTaxonomy} confidence=${cluster.confidence}`
        );
      }
    }
    return 0;
  }

  if (command === "repair-constants") {
    const includeImpact = hasFlag("--impact");
    const acceptDrift = hasFlag("--accept-drift");
    const dryRun = hasFlag("--dry-run") || (!acceptDrift && !hasFlag("--yes"));
    const message = argValue("--message");
    if (acceptDrift) {
      if (dryRun) {
        const snapshot = await buildConstantRepairPlan(projectRoot);
        if (jsonMode) {
          process.stdout.write(
            `${JSON.stringify({ dryRun: true, acceptDrift: true, plan: snapshot }, null, 2)}\n`
          );
        } else {
          logger.section("Accept Constant Drift");
          logger.info(
            "dry-run: would update .kimi/var/constants-golden.json to current bunfig.toml"
          );
          if (message) logger.info(`Message: ${message}`);
          logger.warn("Dry run — pass --yes to write the new golden template");
        }
        return 0;
      }
      const accepted = await acceptConstantsDrift({
        projectRoot,
        traceId: trace.traceId,
        message,
      });
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(accepted, null, 2)}\n`);
      } else {
        logger.section("Accept Constant Drift");
        logger.info(accepted.detail);
        logger.info(`Decision: ${accepted.decisionId}`);
      }
      return 0;
    }

    const plan = await buildConstantRepairPlan(projectRoot);
    if (!plan.canRepair && plan.goldenVersion === "missing") {
      logger.error("Golden template missing — run: kimi-heal constants snapshot");
      return 1;
    }

    const result = await repairConstants({
      projectRoot,
      dryRun,
      traceId: trace.traceId,
      includeImpact,
    });

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      logger.section("Repair Constants");
      if (dryRun && plan.repairCount > 0) {
        for (const line of renderRepairPreview(result)) logger.line(line);
      } else {
        logger.info(result.detail);
      }
      if (!dryRun && plan.repairCount > 0) {
        logger.info(`${plan.repairCount} constant(s) drifted:`);
        for (const key of plan.diff.missingKeys) {
          logger.line(`  ${key}  (missing) -> golden`);
        }
        for (const item of plan.diff.invalidKeys) {
          logger.line(
            `  ${item.key}  ${String(item.expected)}->${String(item.actual)}->${String(item.expected)}`
          );
        }
      }
      if (result.duplicateDecisionId) {
        logger.info(`Duplicate repair decision suppressed: ${result.duplicateDecisionId}`);
      }
      if (!dryRun && result.impact && result.impact.length > 0) {
        for (const impact of result.impact) {
          logger.line(`  ${impact.key}`);
          logger.line(`    Bound taxonomies: ${impact.boundTaxonomies.join(", ") || "none"}`);
          logger.line(`    Services affected: ${impact.servicesAffected.join(", ") || "none"}`);
          logger.line(
            `    Estimated risk: ${impactRiskLabel(impact.activeFailures, impact.estimatedRisk)}`
          );
        }
      }
      if (result.decisionId) {
        logger.info(`Decision: ${result.decisionId}`);
        logger.info(`Run 'kimi-decision why ${result.decisionId}' for full rationale`);
      }
      if (dryRun && result.repairedBunfig && plan.repairCount === 0) {
        logger.warn("Dry run — pass --yes to write repaired bunfig.toml");
      }
    }
    return result.applied || dryRun ? 0 : plan.canRepair ? 1 : 0;
  }

  if (command === "suggest") {
    const errorId = argValue("--error-id");
    if (!errorId) {
      logger.error("Usage: suggest --error-id <id> [--json]");
      return 1;
    }

    const report = await Effect.runPromise(
      suggestErrorWithBoundConstantsEffect(errorId, { projectRoot })
    );
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      logger.section("Error Suggest");
      logger.line(formatErrorSuggestReport(report));
    }
    return 0;
  }

  if (command === "constants") {
    const sub = args[1] ?? "snapshot";
    if (sub === "snapshot") {
      const golden = await writeConstantsGolden(projectRoot, undefined, {
        message: argValue("--message"),
      });
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`);
      } else {
        logger.section("Constants Snapshot");
        logger.info(`Golden template v${golden.tuningSetVersion}`);
        logger.info(`${Object.keys(golden.constants).length} constant(s) captured`);
        if (golden.message) logger.info(`Message: ${golden.message}`);
        logger.info(`Path: .kimi/var/constants-golden.json`);
      }
      return 0;
    }
    if (sub === "archives") {
      const archives = await listGoldenArchives(projectRoot);
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(archives, null, 2)}\n`);
      } else {
        logger.section("Golden Archives");
        if (archives.length === 0) {
          logger.info("No archived golden snapshots");
        } else {
          for (const archive of archives) {
            logger.line(`  ${archive.name} — v${archive.tuningSetVersion} @ ${archive.capturedAt}`);
          }
        }
      }
      return 0;
    }
    if (sub === "restore") {
      const archiveName = args[2];
      const dryRun = hasFlag("--dry-run") || !hasFlag("--yes");
      if (!archiveName) {
        logger.error("Usage: constants restore <archive-name> [--dry-run|--yes] [--json]");
        return 1;
      }
      if (dryRun) {
        const archives = await listGoldenArchives(projectRoot);
        const match = archives.find((item) => item.name === archiveName);
        if (!match) {
          logger.error(`Archive not found: ${archiveName}`);
          return 1;
        }
        logger.section("Restore Golden");
        logger.info(`dry-run: would restore ${archiveName} (v${match.tuningSetVersion})`);
        logger.warn("Dry run — pass --yes to write constants-golden.json");
        return 0;
      }
      const golden = await restoreGoldenFromArchive(projectRoot, archiveName);
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`);
      } else {
        logger.section("Restore Golden");
        logger.info(`Restored ${archiveName} → .kimi/var/constants-golden.json`);
        logger.info(`Golden template v${golden.tuningSetVersion}`);
      }
      return 0;
    }
    if (sub === "optimize") {
      const recommendations = await Effect.runPromise(
        generateOptimizerDoctorRecommendationsEffect(projectRoot)
      );
      const applyRequested = hasFlag("--apply");
      const minConfidence = numericArg("--min-confidence", 0.7);
      if (minConfidence < 0 || minConfidence > 1) {
        logger.error("--min-confidence must be between 0 and 1");
        return 1;
      }

      if (applyRequested) {
        const requestedConstants = argList("--apply");
        if (requestedConstants.length === 0) {
          logger.error(
            "Usage: constants optimize --apply <CONSTANT[,CONSTANT]|all> [--min-confidence 0.7] [--yes] [--json]"
          );
          return 1;
        }
        const result = await Effect.runPromise(
          applyOptimizerRecommendationsEffect({
            projectRoot,
            recommendations,
            requestedConstants,
            minConfidence,
            dryRun: hasFlag("--dry-run") || !hasFlag("--yes"),
            traceId: trace.traceId,
          })
        );
        if (jsonMode) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          logger.section("Constant Optimizer Apply");
          logger.info(result.detail);
          for (const line of formatOptimizerApplyResultLines(result)) logger.line(line);
        }
        return result.applied || result.dryRun ? 0 : 1;
      }

      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify(
            {
              schemaVersion: 1,
              recommendations: optimizerRecommendationsToJson(recommendations),
            },
            null,
            2
          )}\n`
        );
      } else {
        if (recommendations.length > 0) {
          printConstantOptimizerRecommendationsBlock(logger, recommendations);
        } else {
          const report = await buildConstantOptimizerReport(projectRoot);
          logger.section("Constant Optimizer");
          logger.line(formatConstantOptimizerReport(report));
        }
      }
      return 0;
    }
    logger.error(`Unknown constants subcommand: ${sub}`);
    return 1;
  }

  if (command === "effect") {
    const sub = args[1];
    if (sub !== "audit") {
      logger.error(
        "Usage: effect audit [--check-tags] [--event-streams] [--json] [--project-root <path>]"
      );
      return 1;
    }

    const writer = createCli(Bun.argv, "kimi-heal", { humanStderr: true });
    const checkTags = hasFlag("--check-tags");
    const eventStreams = hasFlag("--event-streams");
    const auditProjectRoot = argValue("--project-root") || projectRoot;

    const report = await buildEffectGatesReport({
      projectRoot: auditProjectRoot,
      tool: "kimi-heal",
      thresholdOverrides: {
        serviceTagRequired: KIMI_SERVICE_TAG_REQUIRED || checkTags,
        eventStreamsEnabled: eventStreams,
      },
    });

    if (writer.flags.json) {
      writer.writeJsonSchema("effect-gates-report", report);
    } else {
      writer.info("── Effect Audit ──────────────────────────────────────────────");
      writer.info(
        `${report.summary.total} violation(s), ${report.summary.errors} error(s), ${report.summary.warnings} warning(s)`
      );
      for (const violation of report.violations) {
        const message = violation.location
          ? `${violation.location}: ${violation.message}`
          : violation.message;
        if (violation.severity === "error") writer.error(message);
        else writer.warn(message);
      }
    }
    return report.violations.length > 0 ? 1 : 0;
  }

  logger.section("kimi-heal commands");
  logger.line("  plan [--json]                         Proposed heal actions + decision refs");
  logger.line("  apply --action <id> [--dry-run|--yes] Apply heal with decision logging");
  logger.line("  clusters [--json]                     Semantic failure clusters");
  logger.line("  suggest --error-id <id> [--json]      Cluster suggestion + bound constants");
  logger.line("  repair-constants [--all] [--impact] [--accept-drift] [--dry-run|--yes]");
  logger.line("  constants snapshot [--message <text>] [--json] Capture golden template");
  logger.line("  constants archives [--json]         List archived golden snapshots");
  logger.line("  constants restore <name> [--dry-run|--yes]  Restore golden from archive");
  logger.line(
    "  constants optimize [--apply <keys|all>] [--min-confidence 0.7] [--dry-run|--yes] [--json]"
  );
  logger.line("  effect audit [--check-tags] [--event-streams] [--json]  Effect discipline audit");
  return command === "help" ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
    }),
    { toolName: "kimi-heal", logger }
  );
  process.exit(exitCode);
}
