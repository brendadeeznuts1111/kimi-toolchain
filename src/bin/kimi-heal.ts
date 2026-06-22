#!/usr/bin/env bun
/**
 * kimi-heal — failure clustering and local healing hints.
 */

import { Effect } from "effect";
import { join } from "path";
import { createLogger } from "../lib/logger.ts";
import { clusterFailureLedgerEffect, matchErrorToClusters } from "../lib/error-clustering.ts";
import {
  applyHealPlanEffect,
  buildHealPlanEffect,
  type HealApplyReport,
  type HealPlan,
} from "../lib/self-healing.ts";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { parseCliFlags, writeStdoutLine } from "../lib/cli-contract.ts";
import { resolveProjectRoot } from "../lib/utils.ts";

const logger = createLogger(Bun.argv, "kimi-heal");

export interface AuditIssue {
  file: string;
  message: string;
  severity: "error" | "warn";
  type?: string;
  line?: number;
  column?: number;
  rule?: string;
}

function scanFunctionBodies(text: string): Array<{ name: string; body: string }> {
  const functions: Array<{ name: string; body: string }> = [];
  const functionRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)[^{]*\{/gm;
  let match: RegExpExecArray | null;
  const matches: Array<{ name: string; start: number }> = [];
  while ((match = functionRegex.exec(text)) !== null) {
    matches.push({ name: match[1]!, start: match.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.start;
    const end = i < matches.length - 1 ? matches[i + 1]!.start : text.length;
    functions.push({ name: matches[i]!.name, body: text.slice(start, end) });
  }
  return functions;
}

export async function auditEffects(
  _entryPath?: string,
  options: {
    checkPipeline?: boolean;
    checkBarePromises?: boolean;
    checkDomainPurity?: boolean;
    scanDir?: string;
  } = {}
): Promise<AuditIssue[]> {
  const scanDir = options.scanDir ?? "src";
  const checkBare = options.checkBarePromises !== false;
  const checkPurity = options.checkDomainPurity !== false;

  const issues: AuditIssue[] = [];
  const glob = new Bun.Glob("**/*.ts");

  for (const relPath of glob.scanSync({ cwd: scanDir, absolute: false })) {
    if (relPath.endsWith(".test.ts")) continue;
    const fullPath = join(scanDir, relPath);
    const source = Bun.file(fullPath);
    if (!(await source.exists())) continue;
    let text: string;
    try {
      text = await source.text();
    } catch {
      continue;
    }

    for (const { name, body } of scanFunctionBodies(text)) {
      if (
        checkBare &&
        /Promise\.resolve|Promise\.reject|new\s+Promise[<(]|\.then\s*\(/.test(body)
      ) {
        issues.push({
          file: fullPath,
          message: `${name}: bare Promise detected — wrap in Effect`,
          severity: "error",
          type: "bare-promise",
        });
      }
      if (checkPurity && /getEffect\s*\(\s*["']kimi\.effect\./.test(body)) {
        issues.push({
          file: fullPath,
          message: `${name}: domain imports effect directly — pass as arg`,
          severity: "error",
          type: "no-tag-service",
        });
      }
    }
  }

  return issues;
}

async function emitJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-heal <plan|apply|clusters|match> [text] [--json] [--threshold <0..1>]");
  logger.line("");
  logger.line("Examples:");
  logger.line("  kimi-heal plan --json");
  logger.line("  kimi-heal apply --dry-run --json");
  logger.line("  kimi-heal apply --yes --action <id>");
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

function argValues(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < Bun.argv.length; index++) {
    if (Bun.argv[index] === flag && Bun.argv[index + 1]) values.push(Bun.argv[index + 1]);
  }
  return values;
}

async function main(): Promise<number> {
  const { json } = parseCliFlags(Bun.argv, "kimi-heal");
  const argv = Bun.argv.slice(2);
  const command = argv.find((arg) => !arg.startsWith("--"));

  if (!command || command === "help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "plan") {
    const plan = await Effect.runPromise(
      buildHealPlanEffect(await resolveProjectRoot(), { threshold: threshold() })
    );
    if (json) await emitJson(plan);
    else printPlan(plan);
    return 0;
  }

  if (command === "apply") {
    const projectRoot = await resolveProjectRoot();
    const plan = await Effect.runPromise(
      buildHealPlanEffect(projectRoot, { threshold: threshold() })
    );
    const report = await Effect.runPromise(
      applyHealPlanEffect(plan, {
        projectRoot,
        dryRun: Bun.argv.includes("--dry-run") ? true : undefined,
        yes: Bun.argv.includes("--yes"),
        actionIds: argValues("--action"),
      })
    );
    if (json) await emitJson(report);
    else printApplyReport(report);
    return report.summary.failed > 0 ? 1 : 0;
  }

  if (command === "clusters") {
    const report = await Effect.runPromise(clusterFailureLedgerEffect({ threshold: threshold() }));
    if (json) await emitJson(report.summaries);
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
    const report = await Effect.runPromise(clusterFailureLedgerEffect({ threshold: threshold() }));
    const match = matchErrorToClusters(text, report.clusters);
    if (json) await emitJson({ query: text, match });
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
    if (action.decisionPreviewId) logger.line(`      decision: ${action.decisionPreviewId}`);
    logger.line(`      ${action.reason}`);
    if (action.command) logger.line(`      command: ${action.command.join(" ")}`);
  }
}

function printApplyReport(report: HealApplyReport): void {
  logger.banner("Kimi Heal Apply");
  logger.info(
    `${report.summary.applied} applied, ${report.summary.failed} failed, ${report.summary.skipped} skipped`
  );
  for (const action of report.applied) {
    logger.line(`  [${action.status}] ${action.id}: ${action.title}`);
    if (action.decisionId) logger.line(`      decision: ${action.decisionId}`);
    if (action.reason) logger.line(`      ${action.reason}`);
    if (action.command) logger.line(`      command: ${action.command.join(" ")}`);
  }
}

if (isDirectRun(import.meta.path)) {
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
}
