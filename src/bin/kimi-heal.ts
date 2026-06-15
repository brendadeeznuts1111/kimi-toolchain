#!/usr/bin/env bun
/**
 * kimi-heal — Self-healing with decision ledger integration
 *
 * Usage:
 *   kimi-heal plan [--json]
 *   kimi-heal apply --action <id> [--dry-run] [--yes] [--json]
 *   kimi-heal repair-constants [--dry-run|--yes] [--json]
 *   kimi-heal constants snapshot [--json]
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import { applyHealAction, buildHealPlan } from "../lib/self-healing.ts";
import { clusterFailureLedger } from "../lib/error-clustering.ts";
import { ensureProcessTrace } from "../lib/effect/trace-context.ts";
import {
  buildConstantRepairPlan,
  repairConstants,
  writeConstantsGolden,
} from "../lib/constants-heal.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] ?? "plan";
  const jsonMode = hasFlag("--json");
  const projectRoot = await resolveDecisionsRoot();
  const trace = ensureProcessTrace();

  if (command === "plan") {
    const plan = await buildHealPlan({ projectRoot, traceId: trace.traceId });
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
    const plan = await buildHealPlan({ projectRoot, traceId: trace.traceId });
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
    const report = await clusterFailureLedger({ persist: true });
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
    const dryRun = hasFlag("--dry-run") || !hasFlag("--yes");
    const plan = await buildConstantRepairPlan(projectRoot);
    if (!plan.canRepair && plan.goldenVersion === "missing") {
      logger.error("Golden template missing — run: kimi-heal constants snapshot");
      return 1;
    }

    const result = await repairConstants({
      projectRoot,
      dryRun,
      traceId: trace.traceId,
    });

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      logger.section("Repair Constants");
      logger.info(result.detail);
      if (result.decisionId) {
        logger.info(`Decision: ${result.decisionId}`);
        logger.info(`Run 'kimi-decision why ${result.decisionId}' for full rationale`);
      }
      if (dryRun && result.repairedBunfig) {
        logger.warn("Dry run — pass --yes to write repaired bunfig.toml");
      }
    }
    return result.applied || dryRun ? 0 : plan.canRepair ? 1 : 0;
  }

  if (command === "constants") {
    const sub = args[1] ?? "snapshot";
    if (sub === "snapshot") {
      const golden = await writeConstantsGolden(projectRoot);
      if (jsonMode) {
        process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`);
      } else {
        logger.section("Constants Snapshot");
        logger.info(`Golden template v${golden.tuningSetVersion}`);
        logger.info(`${Object.keys(golden.constants).length} constant(s) captured`);
        logger.info(`Path: .kimi/var/constants-golden.json`);
      }
      return 0;
    }
    logger.error(`Unknown constants subcommand: ${sub}`);
    return 1;
  }

  logger.section("kimi-heal commands");
  logger.line("  plan [--json]                         Proposed heal actions + decision refs");
  logger.line("  apply --action <id> [--dry-run|--yes] Apply heal with decision logging");
  logger.line("  clusters [--json]                     Semantic failure clusters");
  logger.line(
    "  repair-constants [--dry-run|--yes]    Restore bunfig [define] from golden template"
  );
  logger.line(
    "  constants snapshot [--json]           Capture golden template (.kimi/var/constants-golden.json)"
  );
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
