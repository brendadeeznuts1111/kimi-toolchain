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
 *   kimi-heal --fix [--dry-run] [--yes] [--json]   Advanced Effect repairs
 *   kimi-heal effect audit --fix [--dry-run] [--yes] [--json]
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { createCli } from "../lib/cli-contract.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import { applyHealAction, buildHealPlanEffect } from "../lib/self-healing.ts";
import { spawnBun } from "../lib/tool-runner.ts";
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
import { applyEffectHealFix } from "../lib/effect-heal-fix.ts";
import { EFFECT_PIPELINE, EFFECT_PIPELINE_NAMES } from "../lib/symbols.ts";
import { scanEffectMethods, type EffectMethod } from "../harness/transpiler-scan.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

// ── Effect Audit (profile-aware) ──────────────────────────────────────────

interface AuditIssue {
  type: "missing-symbol" | "unused-effect" | "circular-import" | "bare-promise" | "no-tag-service";
  file: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
}

/** Profile-scoped audit configuration. */
interface AuditProfile {
  checkPipeline: boolean;
  checkBarePromises: boolean;
  checkDomainPurity: boolean;
  scanPatterns: string[];
}

const AUDIT_PROFILES: Record<string, AuditProfile> = {
  toolchain: {
    checkPipeline: true,
    checkBarePromises: true,
    checkDomainPurity: true,
    scanPatterns: ["src/effect/**/*.ts", "src/domain/**/*.ts", "src/guardian/**/*.ts"],
  },
  minimal: {
    checkPipeline: false,
    checkBarePromises: false,
    checkDomainPurity: false,
    scanPatterns: [],
  },
  ci: {
    checkPipeline: true,
    checkBarePromises: true,
    checkDomainPurity: false,
    scanPatterns: ["src/effect/**/*.ts"],
  },
};

/**
 * Run profile-aware effect discipline checks.
 *
 * Checks:
 *   1. missing-symbol — EFFECT_PIPELINE symbol has no globalThis handler
 *   2. bare-promise — Promise.resolve() without Effect wrapper (regex scan)
 *   3. no-tag-service — domain/ imports effect directly (regex scan)
 */
function auditEffects(profile?: string): AuditIssue[] {
  const cfg = profile
    ? (AUDIT_PROFILES[profile] ?? AUDIT_PROFILES.toolchain)
    : AUDIT_PROFILES.toolchain;
  const issues: AuditIssue[] = [];

  // 1. Missing symbols — every EFFECT_PIPELINE stage must have a handler
  if (cfg.checkPipeline) {
    for (const sym of EFFECT_PIPELINE) {
      const handler = (globalThis as Record<string | symbol, unknown>)[sym];
      if (!handler) {
        const key = sym.toString();
        const label = EFFECT_PIPELINE_NAMES[key] ?? key;
        issues.push({
          type: "missing-symbol",
          file: "globalThis",
          message: `EFFECT_PIPELINE stage "${label}" (${key}) has no registered handler`,
          severity: "error",
        });
      }
    }
  }

  // 2-3. Bare promises + domain purity — scan source files
  if (cfg.checkBarePromises || cfg.checkDomainPurity) {
    for (const pattern of cfg.scanPatterns) {
      let methods: EffectMethod[];
      try {
        methods = scanEffectMethods(pattern);
      } catch {
        continue;
      }

      for (const m of methods) {
        let source: string;
        try {
          source = Bun.file(m.sourceFile).textSync?.() ?? "";
        } catch {
          continue;
        }
        if (!source) continue;

        // 2. Bare promises: Promise.resolve / new Promise without Effect wrapper
        if (cfg.checkBarePromises) {
          if (
            (source.includes("Promise.resolve") || source.includes("new Promise")) &&
            !source.includes("Effect.")
          ) {
            issues.push({
              type: "bare-promise",
              file: m.sourceFile,
              message: `${m.methodName}: bare Promise detected — wrap in Effect`,
              severity: "error",
            });
          }
        }

        // 3. Domain purity: domain/ files importing getEffect directly
        if (cfg.checkDomainPurity) {
          if (m.sourceFile.includes("domain/") && source.includes("getEffect")) {
            issues.push({
              type: "no-tag-service",
              file: m.sourceFile,
              message: `${m.methodName}: domain imports effect directly — pass as arg`,
              severity: "error",
            });
          }
        }
      }
    }
  }

  return issues;
}

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

async function runEffectHealFixMode(projectRoot: string, jsonMode: boolean): Promise<number> {
  const dryRun = hasFlag("--dry-run") || !hasFlag("--yes");
  const result = await applyEffectHealFix({ projectRoot, dryRun });
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.remainingViolations > 0 ? 1 : 0;
  }
  logger.section("Effect Heal Fix");
  logger.info(dryRun ? "dry-run — pass --yes to write files" : "repairs applied");
  logger.info(`${result.filesTouched} file(s) touched, ${result.changes.length} change(s)`);
  for (const change of result.changes.slice(0, 20)) {
    logger.line(`  [${change.kind}] ${change.file}: ${change.detail}`);
  }
  if (result.changes.length > 20) {
    logger.line(`  … +${result.changes.length - 20} more`);
  }
  logger.info(
    `${result.remainingViolations} direct-promise/domain violation(s) remain — review manually`
  );
  return result.remainingViolations > 0 && !dryRun ? 1 : 0;
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] ?? "plan";
  const jsonMode = hasFlag("--json");
  const projectRoot = await resolveDecisionsRoot();
  const trace = ensureProcessTrace();

  if (hasFlag("--fix") && command !== "effect" && command !== "apply") {
    return runEffectHealFixMode(projectRoot, jsonMode);
  }

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
              const result = await spawnBun(["run", "sync"], { cwd: projectRoot });
              return {
                success: result.exitCode === 0,
                detail:
                  result.exitCode === 0
                    ? "bun run sync completed"
                    : `sync exited ${result.exitCode}`,
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
        "Usage: effect audit [--check-tags] [--event-streams] [--json] [--project-root <path>] [--check-pipeline] [--profile <name>]"
      );
      return 1;
    }

    const writer = createCli(Bun.argv, "kimi-heal", { humanStderr: true });
    const checkTags = hasFlag("--check-tags");
    const eventStreams = hasFlag("--event-streams");
    const checkPipeline = hasFlag("--check-pipeline");
    const auditProjectRoot = argValue("--project-root") || projectRoot;
    const profile = argValue("--profile");

    const report = await buildEffectGatesReport({
      projectRoot: auditProjectRoot,
      tool: "kimi-heal",
      thresholdOverrides: {
        serviceTagRequired: KIMI_SERVICE_TAG_REQUIRED || checkTags,
        eventStreamsEnabled: eventStreams,
      },
    });

    // Run supplementary pipeline-aware audit when requested
    let pipelineIssues: AuditIssue[] = [];
    if (checkPipeline || profile) {
      pipelineIssues = auditEffects(profile);
    }

    const totalViolations = report.violations.length + pipelineIssues.length;
    const totalErrors =
      report.summary.errors + pipelineIssues.filter((i) => i.severity === "error").length;

    if (writer.flags.json) {
      writer.writeJsonSchema("effect-gates-report", {
        ...report,
        pipelineIssues: pipelineIssues.length > 0 ? pipelineIssues : undefined,
        summary: {
          ...report.summary,
          total: totalViolations,
          errors: totalErrors,
        },
      });
    } else {
      writer.info("── Effect Audit ──────────────────────────────────────────────");
      if (profile) writer.info(`Profile: ${profile}`);
      writer.info(
        `${totalViolations} violation(s), ${totalErrors} error(s), ${report.summary.warnings} warning(s)`
      );
      for (const violation of report.violations) {
        const message = violation.location
          ? `${violation.location}: ${violation.message}`
          : violation.message;
        if (violation.severity === "error") writer.error(message);
        else writer.warn(message);
      }
      if (pipelineIssues.length > 0) {
        writer.info("── Pipeline Audit ───────────────────────────────────────────");
        for (const issue of pipelineIssues) {
          const message = issue.line
            ? `${issue.file}:${issue.line}: ${issue.message}`
            : `${issue.file}: ${issue.message}`;
          if (issue.severity === "error") writer.error(message);
          else writer.warn(message);
        }
      }
    }

    if (hasFlag("--fix")) {
      const fixResult = await applyEffectHealFix({
        projectRoot: auditProjectRoot,
        dryRun: hasFlag("--dry-run") || !hasFlag("--yes"),
      });
      if (writer.flags.json) {
        process.stdout.write(`${JSON.stringify({ fix: fixResult }, null, 2)}\n`);
      } else {
        writer.info("── Effect Heal Fix ──────────────────────────────────────────");
        writer.info(
          `${fixResult.filesTouched} file(s) touched · ${fixResult.remainingViolations} violation(s) remain`
        );
      }
      if (fixResult.remainingViolations > 0 && !hasFlag("--dry-run") && hasFlag("--yes")) {
        return 1;
      }
    }

    return totalViolations > 0 ? 1 : 0;
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
  logger.line(
    "  effect audit [--check-tags] [--event-streams] [--json] [--check-pipeline] [--profile <name>] [--fix]"
  );
  logger.line(
    "                                              Effect discipline audit + optional --fix repairs"
  );
  logger.line(
    "  --fix [--dry-run|--yes] [--json]          Auto-wrap bare promises / rewrite domain imports"
  );
  logger.line("    --profile toolchain|minimal|ci             Profile-scoped pipeline checks");
  logger.line("    --check-pipeline                           Run EFFECT_PIPELINE symbol audit");
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
