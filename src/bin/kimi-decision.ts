#!/usr/bin/env bun
/**
 * kimi-decision — Decision ledger CLI: log, graph, why, suggest
 *
 * Usage:
 *   kimi-decision graph <traceId> [--json]
 *   kimi-decision why <decisionId> [--json]
 *   kimi-decision suggest [--cluster-id <id>] [--json]
 *   kimi-decision log --action heal --trace-id <id> [--json]
 *   kimi-decision score [--json]
 */

import { Effect } from "effect";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import {
  buildDecisionGraph,
  logDecision,
  readDecisions,
  renderDecisionGraphAscii,
  suggestDecisions,
  buildWhyReport,
  type DecisionAction,
} from "../lib/decision-ledger.ts";
import {
  scoreAllDecisions,
  filterLowQualityDecisions,
  filterUnverifiedDecisions,
} from "../lib/decision-scoring.ts";

const logger = createLogger(Bun.argv, "kimi-decision");

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
  const command = args[0] ?? "help";
  const jsonMode = hasFlag("--json");
  const projectRoot = await resolveDecisionsRoot();

  if (command === "graph") {
    const traceId = args[1];
    if (!traceId || traceId.startsWith("--")) {
      logger.error("Usage: graph <traceId> [--json]");
      return 1;
    }
    const decisions = await readDecisions(projectRoot);
    const graph = buildDecisionGraph(decisions, traceId);
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
    } else {
      logger.section("Decision Graph");
      for (const line of renderDecisionGraphAscii(graph).split("\n")) logger.line(line);
    }
    return 0;
  }

  if (command === "why") {
    const decisionId = args[1];
    if (!decisionId || decisionId.startsWith("--")) {
      logger.error("Usage: why <decisionId> [--json]");
      return 1;
    }
    const report = await buildWhyReport(decisionId, projectRoot);
    if (!report) {
      logger.error(`Decision not found: ${decisionId}`);
      return 1;
    }
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const { decision } = report;
      logger.section(`Why ${decision.decisionId}`);
      logger.info(`Action: ${decision.action} (${decision.actor})`);
      logger.info(`Summary: ${decision.rationale.summary}`);
      logger.line("");
      logger.line(decision.rationale.fullReasoning);
      if (decision.qualityScore !== undefined) {
        logger.info(`Quality score: ${decision.qualityScore.toFixed(3)}`);
      }
      if (decision.alternatives.length > 0) {
        logger.info("Alternatives considered:");
        for (const alt of decision.alternatives) {
          logger.line(
            `  • ${alt.action} (${alt.feasibility})${alt.reason ? ` — ${alt.reason}` : ""}`
          );
        }
      }
      if (report.traceTree.length > 0) {
        logger.info("Triggering trace steps:");
        for (const event of report.traceTree.slice(0, 8)) {
          const cmd = event.command?.join(" ") ?? event.tool;
          logger.line(`  ${event.startedAt.slice(0, 19)} ${event.status} ${cmd}`);
        }
      }
    }
    return 0;
  }

  if (command === "suggest") {
    const clusterId = argValue("--cluster-id");
    const suggestions = await suggestDecisions({ clusterId, projectRoot });
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify({ suggestions }, null, 2)}\n`);
    } else {
      logger.section("Decision Suggestions");
      if (suggestions.length === 0) {
        logger.info("No high-quality past decisions matched");
      } else {
        for (const item of suggestions) {
          logger.line(
            `  ${item.decisionId} confidence=${item.confidence.toFixed(2)} quality=${item.qualityScore.toFixed(2)} — ${item.summary}`
          );
        }
      }
    }
    return 0;
  }

  if (command === "score") {
    const report = await scoreAllDecisions({ projectRoot });
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      logger.section("Decision Quality Scoring");
      logger.info(`Scored ${report.total} decisions in ${report.durationMs}ms`);
      for (const result of report.results.slice(-10)) {
        logger.line(
          `  ${result.decisionId} → ${result.qualityScore} (${result.factors.join(", ")})`
        );
      }
    }
    return 0;
  }

  if (command === "log") {
    const action = (argValue("--action") ?? "heal") as DecisionAction;
    const traceId = argValue("--trace-id") ?? argValue("--traceId");
    const clusterId = argValue("--cluster-id");
    const errorId = argValue("--error-id");
    const reasoning = argValue("--reasoning") ?? argValue("--summary");
    if (!traceId) {
      logger.error("Usage: log --action <action> --trace-id <traceId> [--cluster-id] [--json]");
      return 1;
    }
    const decision = await logDecision(
      {
        action,
        trigger: { traceId, clusterId, errorId },
        rationaleOverride: reasoning
          ? { summary: reasoning.slice(0, 120), fullReasoning: reasoning, evidence: [] }
          : undefined,
        outcome: { result: "success", verifiedAt: new Date().toISOString() },
      },
      { projectRoot }
    );
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    } else {
      logger.info(`Logged decision ${decision.decisionId}`);
      logger.info(decision.rationale.summary);
    }
    return 0;
  }

  if (command === "audit") {
    const decisions = await readDecisions(projectRoot);
    const low = filterLowQualityDecisions(decisions);
    const unverified = filterUnverifiedDecisions(decisions);
    const payload = {
      total: decisions.length,
      lowQuality: low.map((d) => ({
        decisionId: d.decisionId,
        qualityScore: d.qualityScore,
        summary: d.rationale.summary,
      })),
      unverified: unverified.map((d) => ({
        decisionId: d.decisionId,
        outcome: d.outcome.result,
        summary: d.rationale.summary,
      })),
    };
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      logger.section("Decision Audit");
      logger.warn(`Low quality: ${low.length}`);
      for (const item of low.slice(0, 5)) {
        logger.line(
          `  ${item.decisionId} (${item.qualityScore ?? "n/a"}) ${item.rationale.summary}`
        );
      }
      logger.info(`Unverified: ${unverified.length}`);
    }
    return 0;
  }

  logger.section("kimi-decision commands");
  logger.line("  graph <traceId> [--json]       Decision DAG for a trace");
  logger.line("  why <decisionId> [--json]      Full rationale + evidence");
  logger.line("  suggest [--cluster-id] [--json] Past high-quality actions");
  logger.line("  score [--json]                 Re-score all decisions");
  logger.line("  log --action --trace-id [...]  Manual decision entry");
  logger.line("  audit [--json]                 Low-quality + unverified summary");
  return command === "help" ? 0 : 1;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) => new CliError({ message: e instanceof Error ? e.message : String(e) }),
    }),
    { toolName: "kimi-decision", logger }
  );
  process.exit(exitCode);
}
