#!/usr/bin/env bun
/**
 * kimi-doctor — Comprehensive diagnostics
 * Delegates to individual tool doctor commands + runs system checks
 * Usage: kimi-doctor [--fix] [--quick] [--soft-system] [--memory-budget] [--json]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { basename, join } from "path";
import { homeDir, toolsDir } from "../lib/paths.ts";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  hasUncommittedChanges,
  readManifest,
} from "../lib/version.ts";
import { runSystemChecks, printMemoryBudget, countBlockingErrors } from "../lib/system-checks.ts";
import { detectSyncDrift } from "../lib/sync-hashes.ts";
import {
  auditWorkspaceHealth,
  countWorkspaceBlockers,
  fixWorkspaceHealth,
  isKimiToolchainRepo,
  WORKSPACE_SOFT_NAMES,
} from "../lib/workspace-health.ts";
import { auditEcosystemHealth } from "../lib/ecosystem-health.ts";
import { fixMcpConfig, validateMcpConfig } from "../lib/mcp-config.ts";
import {
  auditKimiConfig,
  mergeConfigTomlHooks,
  mergeConfigTomlPermissions,
} from "../lib/kimi-config-audit.ts";
import { getOrphanProcesses, runOrphanKill } from "../lib/process-utils.ts";
import { isAgentContext } from "../lib/tool-runner.ts";
import { resolveProjectRoot, getProjectName } from "../lib/utils.ts";
import { runWorkspaceCommand } from "../lib/workspace-commands.ts";
import { auditAgentReady } from "../lib/agent-ready.ts";
import { auditSuccessMetrics } from "../lib/success-metrics.ts";
import {
  capabilityReport,
  readCapabilityTrend,
  type CapabilityReport,
} from "../lib/capabilities.ts";
import { queryDecisionLedger } from "../lib/decision-ledger.ts";
import { buildHealPlan, type HealPlan } from "../lib/self-healing.ts";
import { createLogger } from "../lib/logger.ts";
import { aggregateChecks, type HealthCheck } from "../lib/health-check.ts";
import { runSubDoctorsEffect } from "../lib/doctor-pipeline.ts";
import { recordDoctorRun } from "../lib/doctor-runs.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-doctor");

const TOOLS_DIR = toolsDir();
const FIX = Bun.argv.includes("--fix");
const QUICK = Bun.argv.includes("--quick");
const SOFT_SYSTEM = Bun.argv.includes("--soft-system");
const MEMORY_BUDGET = Bun.argv.includes("--memory-budget");
const JSON_OUT = Bun.argv.includes("--json");
const WORKSPACE_ONLY = Bun.argv.includes("--workspace");
const ECOSYSTEM = Bun.argv.includes("--ecosystem");
const AGENT_READY = Bun.argv.includes("--agent-ready");
const SUCCESS_METRICS = Bun.argv.includes("--success-metrics");
const TREND = Bun.argv.includes("--trend");
const FIX_CURSOR = Bun.argv.includes("--fix-cursor");
const FIX_DEEP = Bun.argv.includes("--fix-deep");
const STRICT_WORKSPACE = Bun.argv.includes("--strict-workspace");

/** Agent/programmatic JSON output (--json); bypasses Logger formatting. */
function emitJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  category?: string;
  autoFix?: string;
  taxonomyId?: string;
}

function ok(name: string, message: string): CheckResult {
  const check: HealthCheck = { name, status: "ok", message, fixable: false };
  if (!JSON_OUT) logger.check(check);
  return check;
}

function warn(name: string, message: string): CheckResult {
  const check: HealthCheck = { name, status: "warn", message, fixable: false };
  if (!JSON_OUT) logger.check(check);
  return check;
}

function error(name: string, message: string): CheckResult {
  const check: HealthCheck = { name, status: "error", message, fixable: false };
  if (!JSON_OUT) logger.check(check);
  return check;
}

function parseSemver(version: string): [number, number, number] | null {
  const m = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function semverBelow(version: string | null, floor: [number, number, number]): boolean {
  if (!version) return true;
  const v = parseSemver(version);
  if (!v) return false;
  if (v[0] !== floor[0]) return v[0] < floor[0];
  if (v[1] !== floor[1]) return v[1] < floor[1];
  return v[2] < floor[2];
}

import { runOfficialKimiDoctor } from "../lib/kimi-doctor-wrapper.ts";

async function versionMatrix(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const [desktopVersion, repoHead, dirty, manifest] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    hasUncommittedChanges(),
    readManifest(),
  ]);

  const desktopLabel = desktopVersion ?? "unknown";
  const repoLabel = repoHead ?? "unknown";

  if (desktopVersion) {
    results.push(ok("Desktop (kimi)", desktopLabel));
    if (semverBelow(desktopVersion, [0, 9, 0])) {
      results.push(warn("kimi acp", "requires kimi >= 0.9.0"));
    }
    if (semverBelow(desktopVersion, [0, 10, 0])) {
      results.push(warn("kimi doctor cmd", "requires kimi >= 0.10.0"));
    }
    if (semverBelow(desktopVersion, [0, 12, 0])) {
      results.push(warn("sub-skills", "0.12.0+ for stable sub-skill discovery"));
    } else {
      results.push(ok("sub-skills", "stable since 0.12.0"));
    }
    if (semverBelow(desktopVersion, [0, 14, 0])) {
      results.push(warn("kimi-code update", "0.14.0+ recommended — run kimi upgrade"));
    }
  } else {
    results.push(error("Desktop (kimi)", "not found"));
  }

  results.push(ok("Toolchain", `${TOOLCHAIN_VERSION} (${repoLabel})`));
  results.push(ok("MCP Bridge", TOOLCHAIN_VERSION));

  if (manifest) {
    const syncLabel = `${manifest.lastSyncedAt.slice(0, 19).replace("T", " ")} UTC`;
    if (manifest.gitHead === repoHead && !dirty) {
      results.push(ok("Last sync", syncLabel));
    } else if (dirty) {
      results.push(warn("Last sync", `${syncLabel} — repo has uncommitted changes`));
    } else {
      results.push(warn("Last sync", `${syncLabel} — repo HEAD (${repoLabel}) differs from sync`));
    }
  } else {
    results.push(warn("Last sync", "never — run `bun run sync`"));
  }

  if (dirty) {
    results.push(warn("Working tree", "uncommitted changes present"));
  }

  const localToolsDir = import.meta.dir;
  const runtimeTools = toolsDir();
  if (localToolsDir.startsWith(runtimeTools)) {
    results.push(ok("Runtime", "synced copy in ~/.kimi-code/tools/"));
  } else {
    const repoDir = basename(join(localToolsDir, "..", ".."));
    if (repoDir === "kimi-toolchain") {
      results.push(ok("Repo folder", repoDir));
    } else {
      results.push(warn("Repo folder", `${repoDir} — rename to kimi-toolchain for alignment`));
    }
  }

  return results;
}

async function checkDesktopSync(projectRoot: string): Promise<{
  results: CheckResult[];
  drift?: { synced: boolean; drifted: string[]; missing: string[] };
}> {
  if (!(await isKimiToolchainRepo(projectRoot))) {
    return { results: [] };
  }

  const drift = await detectSyncDrift(projectRoot);
  const results: CheckResult[] = [];

  if (drift.synced) {
    results.push(ok("Desktop sync", "tools/lib/scripts match repo"));
  } else {
    const parts = [...drift.drifted, ...drift.missing.map((m) => `${m} (missing)`)];
    const preview = parts.slice(0, 3).join(", ");
    const more = parts.length > 3 ? ` (+${parts.length - 3} more)` : "";
    results.push(
      error("Desktop sync", `${parts.length} file(s) drifted: ${preview}${more} — run bun run sync`)
    );
  }

  return { results, drift };
}

async function applySyncFix(projectRoot: string): Promise<void> {
  if (!(await isKimiToolchainRepo(projectRoot))) return;

  const syncScript = join(projectRoot, "scripts", "sync-to-desktop.ts");
  const wrapperScript = join(projectRoot, "scripts", "install-bin-wrappers.sh");

  if (existsSync(syncScript)) {
    if (!JSON_OUT) logger.line("  → Running bun run sync...");
    const proc = Bun.spawn(["bun", "run", syncScript], {
      cwd: projectRoot,
      stdout: JSON_OUT ? "pipe" : "inherit",
      stderr: JSON_OUT ? "pipe" : "inherit",
    });
    await proc.exited;
  }

  if (existsSync(wrapperScript)) {
    if (!JSON_OUT) logger.line("  → Installing PATH wrappers...");
    const proc = Bun.spawn(["bash", wrapperScript], {
      cwd: projectRoot,
      stdout: JSON_OUT ? "pipe" : "inherit",
      stderr: JSON_OUT ? "pipe" : "inherit",
    });
    await proc.exited;
  }
}

async function runScript(projectRoot: string, script: string, label: string): Promise<CheckResult> {
  try {
    const proc = Bun.spawn(["bun", "run", script], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) return ok(label, "passed");
    const stderr = await Bun.readableStreamToText(proc.stderr);
    const detail =
      stderr
        .split("\n")
        .find((l) => l.trim())
        ?.slice(0, 80) || `exit ${exitCode}`;
    return error(label, detail);
  } catch (e: unknown) {
    return error(label, e instanceof Error ? e.message : String(e));
  }
}

async function runQualityChecks(projectRoot: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return [warn("quality", "no package.json in project root")];
  }

  results.push(
    existsSync(join(projectRoot, ".oxfmtrc.json"))
      ? ok("oxfmtrc", "present")
      : warn("oxfmtrc", "missing — run kimi-fix")
  );
  results.push(
    existsSync(join(projectRoot, ".oxlintrc.json"))
      ? ok("oxlintrc", "present")
      : warn("oxlintrc", "missing — run kimi-fix")
  );

  results.push(
    existsSync(join(projectRoot, "AGENTS.md"))
      ? ok("project-AGENTS.md", "present")
      : warn("project-AGENTS.md", "missing — run kimi-fix")
  );

  results.push(
    existsSync(join(projectRoot, ".kimi-code", "mcp.json"))
      ? ok("project-mcp.json", "present")
      : warn("project-mcp.json", "missing — run kimi-fix")
  );

  results.push(
    existsSync(join(projectRoot, "scripts", "check.ts"))
      ? ok("scripts/check.ts", "present")
      : warn("scripts/check.ts", "missing — run kimi-fix")
  );

  const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts || {};

  if (!QUICK) {
    const qualityPromises: Promise<CheckResult>[] = [];
    if (scripts["format:check"]) {
      qualityPromises.push(runScript(projectRoot, "format:check", "format:check"));
    }
    if (scripts.lint) {
      qualityPromises.push(runScript(projectRoot, "lint", "lint"));
    }
    if (scripts.typecheck) {
      qualityPromises.push(runScript(projectRoot, "typecheck", "typecheck"));
    }
    if (qualityPromises.length > 0) {
      results.push(...(await Promise.all(qualityPromises)));
    }
  }

  if (scripts.check) {
    results.push(ok("check", "composite script defined"));
  } else {
    results.push(
      warn("check", "script not defined — add format:check && lint && typecheck && test")
    );
  }

  return results;
}

async function applyWorkspaceFixes(projectRoot: string): Promise<void> {
  const home = homeDir();
  const report = await auditWorkspaceHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    home,
  });

  const deep = FIX_DEEP || FIX_CURSOR;
  const result = await fixWorkspaceHealth(report, {
    projectRoot,
    home,
    removeCursorSlugs: deep,
    removeLegacySymlink: deep,
    archiveLegacySessions: FIX_DEEP,
    pruneLegacySessionIndex: FIX_DEEP,
    syncDesktop: true,
    installWrappers: true,
  });

  if (!JSON_OUT) {
    if (result.staleWrappersRemoved > 0) {
      logger.info(`Removed ${result.staleWrappersRemoved} stale PATH wrapper(s)`);
    }
    if (result.snapshotsRemoved > 0) {
      logger.info(`Removed ${result.snapshotsRemoved} orphaned snapshot(s)`);
    }
    if (result.syncRan) logger.info("Desktop sync completed");
    if (result.wrappersInstalled) logger.info("PATH wrappers installed");
    if (result.legacySymlinkRemoved) {
      logger.info("Removed legacy kimicode-cli symlink");
    }
    if (result.cursorSlugsRemoved.length > 0) {
      for (const slug of result.cursorSlugsRemoved) {
        logger.info(`Removed Cursor slug ${slug}`);
      }
      logger.line(
        "  → Quit Cursor fully, then open ~/kimi-toolchain/kimi-toolchain.code-workspace"
      );
    }
    if (result.sessionsArchived.length > 0) {
      logger.info(`Archived ${result.sessionsArchived.length} legacy Kimi session folder(s)`);
    }
    if (result.sessionIndexLinesPruned > 0) {
      logger.info(`Pruned ${result.sessionIndexLinesPruned} legacy session_index line(s)`);
    }
  }
}

async function applyMcpFixes(projectRoot: string): Promise<void> {
  const home = homeDir();
  const isToolchain = await isKimiToolchainRepo(projectRoot);
  const { userChanged, projectCreated } = await fixMcpConfig(
    home,
    isToolchain ? projectRoot : undefined
  );
  if (!JSON_OUT) {
    if (userChanged) logger.info("MCP: unified-shell registered in ~/.kimi-code/mcp.json");
    if (projectCreated) logger.info("MCP: created .kimi-code/mcp.json stub");
  }
}

async function applyFixes(projectRoot: string): Promise<void> {
  const home = homeDir();
  logger.section("Auto-fix");
  await applySyncFix(projectRoot);
  await applyMcpFixes(projectRoot);

  const configMerge = await mergeConfigTomlPermissions(home);
  if (!JSON_OUT) {
    if (configMerge.created) {
      logger.info(`Created ${configMerge.path} with permission snippet`);
    } else if (configMerge.merged) {
      logger.info(`Appended permission snippet to ${configMerge.path}`);
    }
  }

  const hookMerge = await mergeConfigTomlHooks(home);
  if (!JSON_OUT) {
    if (hookMerge.created) {
      logger.info(`Created ${hookMerge.path} with PostToolUseFailure hook`);
    } else if (hookMerge.merged) {
      logger.info(`Appended PostToolUseFailure hook to ${hookMerge.path}`);
    }
  }

  await applyWorkspaceFixes(projectRoot);

  const orphans = getOrphanProcesses();
  if (!JSON_OUT) {
    if (orphans.length > 0) {
      logger.line(`  → Killing ${orphans.length} orphan process(es)...`);
      const { killed } = await runOrphanKill(false);
      logger.info(`Killed ${killed} orphan process(es)`);
    } else {
      logger.info("No orphan processes to kill");
    }
  } else if (orphans.length > 0) {
    await runOrphanKill(false);
  }

  const govPath = join(TOOLS_DIR, "kimi-resource-governor.ts");
  if (existsSync(govPath)) {
    if (!JSON_OUT) logger.line("  → Running kimi-resource-governor fix...");
    const proc = Bun.spawn(["bun", "run", govPath, "fix"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  }

  if (await isKimiToolchainRepo(projectRoot)) {
    const pathReport = await auditWorkspaceHealth(projectRoot);
    const legacyIssue = pathReport.checks.some(
      (c) =>
        (c.name === "cursor-workspace" || c.name === "legacy-clone") &&
        (c.status === "warn" || c.status === "error")
    );
    if (legacyIssue && !FIX_CURSOR) {
      if (!JSON_OUT) logger.line("  → Legacy workspace audit:");
      await runWorkspaceCommand("cleanup", [], projectRoot, logger);
    }
  }
}

async function runWorkspaceMode(projectRoot: string): Promise<number> {
  const home = homeDir();
  const report = await auditWorkspaceHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    home,
  });
  const summary = countWorkspaceBlockers(report, { strictWorkspace: STRICT_WORKSPACE });

  if (JSON_OUT) {
    emitJson({
      checks: report.checks,
      summary: {
        blocking: summary.blocking,
        blockingErrors: summary.blocking,
        warnings: summary.warnings,
        errors: summary.errors,
        ok: summary.blocking === 0,
        strictWorkspace: STRICT_WORKSPACE,
      },
      legacyCursorSlugs: report.legacyCursorSlugs,
    });
    if (FIX) await applyWorkspaceFixes(projectRoot);
    return summary.blocking > 0 ? 1 : 0;
  }

  const healthReport = aggregateChecks("kimi-doctor", report.checks);
  logger.printHealthReport(healthReport, "Workspace Health");

  if (summary.blocking > 0) {
    logger.error(`${summary.blocking} workspace blocker(s)`);
  } else if (summary.warnings > 0) {
    logger.warn(`${summary.warnings} warning(s), no blockers`);
  } else {
    logger.info("Workspace healthy");
  }

  if (FIX) await applyWorkspaceFixes(projectRoot);
  return summary.blocking > 0 ? 1 : 0;
}

async function runEcosystemMode(projectRoot: string): Promise<number> {
  const report = await auditEcosystemHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    quick: QUICK,
  });

  if (JSON_OUT) {
    emitJson({
      checks: report.checks,
      fixPlan: report.fixPlan,
      summary: {
        blockers: report.blockers,
        warnings: report.warnings,
        errors: report.errors,
        ok: report.blockers === 0,
        strictWorkspace: STRICT_WORKSPACE,
        quick: QUICK,
      },
    });
    return report.blockers > 0 ? 1 : 0;
  }

  const checks: HealthCheck[] = report.checks.map((c) => ({
    name: `${c.source}/${c.name}`,
    status: c.status,
    message: c.message,
    fixable: c.fixable,
  }));
  const healthReport = aggregateChecks("kimi-doctor", checks);
  logger.printHealthReport(healthReport, "Ecosystem Health");

  if (report.fixPlan.length > 0) {
    logger.line("");
    logger.line("  Fix plan:");
    for (const step of report.fixPlan) {
      logger.line(`    → ${step}`);
    }
  }

  if (FIX) await applyFixes(projectRoot);
  return report.blockers > 0 ? 1 : 0;
}

async function runAgentReadyMode(projectRoot: string): Promise<number> {
  const report = await auditAgentReady(projectRoot);

  if (JSON_OUT) {
    emitJson({
      checks: report.checks,
      summary: {
        blockers: report.blockers,
        warnings: report.warnings,
        ok: report.ok,
      },
    });
    return report.ok ? 0 : 1;
  }

  logger.banner("Kimi Doctor — Agent Ready");
  logger.printHealthReport(aggregateChecks("kimi-doctor", report.checks), "Agent Readiness");

  if (report.blockers > 0) {
    logger.error(`${report.blockers} agent readiness blocker(s)`);
  } else if (report.warnings > 0) {
    logger.warn(`${report.warnings} warning(s), no blockers`);
  } else {
    logger.info("Agent runtime ready");
  }

  return report.ok ? 0 : 1;
}

async function runSuccessMetricsMode(projectRoot: string): Promise<number> {
  const report = await auditSuccessMetrics(projectRoot);
  const errors = report.checks.filter((c) => c.status === "error").length;

  if (JSON_OUT) {
    emitJson({
      checks: report.checks,
      errorCoverage: {
        total: report.errorCoverage.total,
        classified: report.errorCoverage.classified,
        coverage: report.errorCoverage.coverage,
        unclassified: report.errorCoverage.unclassified.map((f) => ({
          source: f.source,
          toolName: f.toolName,
          output: f.output,
        })),
      },
      providerIntegration: {
        provider: report.providerIntegration.contract.provider,
        service: report.providerIntegration.contract.service,
        artifacts: ["contract", "credential-adapter"],
      },
      thresholdPolicy: report.thresholdPolicy,
      ledger: {
        present: report.ledger.present,
        total: report.ledger.total,
        taxonomyCounts: report.ledger.taxonomyCounts,
        unclassified: report.ledger.unclassified,
      },
      summary: {
        errors,
        ok: errors === 0,
      },
    });
    return errors > 0 ? 1 : 0;
  }

  logger.banner("Kimi Doctor — Success Metrics");
  logger.printHealthReport(aggregateChecks("kimi-doctor", report.checks), "Success Metrics");
  if (errors > 0) logger.error(`${errors} success metric blocker(s)`);
  else logger.info("Success metrics passed");
  return errors > 0 ? 1 : 0;
}

async function runTrendMode(): Promise<number> {
  const trend = await readCapabilityTrend();

  if (JSON_OUT) {
    emitJson(trend);
    return 0;
  }

  logger.banner("Kimi Doctor — Capability Trend");
  if (trend.snapshots.length === 0) {
    logger.warn("No capability snapshots found; run kimi capabilities first.");
    return 0;
  }
  for (const snapshot of trend.snapshots) {
    logger.info(
      `${snapshot.generatedAt}: ${snapshot.readinessScore}% readiness (${snapshot.healthy}/${snapshot.checks.length} healthy)`
    );
  }
  return 0;
}

async function runDecisionLedgerChecks(quick: boolean): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const staleUnknownCutoff = now - 60 * 60 * 1000;
  const recentLimit = quick ? 60 : 300;
  const unknownLimit = quick ? 60 : 300;

  try {
    const recent = await queryDecisionLedger({ since: sevenDaysAgo, limit: recentLimit });
    const lowQuality = recent.filter((decision) => {
      if (typeof decision.qualityScore === "number") return decision.qualityScore < 0.5;
      return decision.outcome.result === "failure";
    });
    if (lowQuality.length === 0) {
      checks.push(ok("decision-quality", "no low-quality decisions in the last 7 days"));
    } else {
      const sample = lowQuality
        .slice(0, 3)
        .map((decision) => decision.decisionId)
        .join(", ");
      checks.push(
        warn(
          "decision-quality",
          `${lowQuality.length} low-quality decision(s) in 7d${sample ? ` (${sample})` : ""}`
        )
      );
    }
  } catch (error) {
    checks.push(
      warn(
        "decision-quality",
        `decision ledger query failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  try {
    const unknown = await queryDecisionLedger({ outcome: "unknown", limit: unknownLimit });
    const unverified = unknown.filter(
      (decision) => Date.parse(decision.timestamp) <= staleUnknownCutoff
    );
    if (unverified.length === 0) {
      checks.push(ok("decision-unverified", "no stale unknown-outcome decisions"));
    } else {
      const sample = unverified
        .slice(0, 3)
        .map((decision) => decision.decisionId)
        .join(", ");
      checks.push(
        warn(
          "decision-unverified",
          `${unverified.length} unknown decision(s) older than 1h${sample ? ` (${sample})` : ""}`
        )
      );
    }
  } catch (error) {
    checks.push(
      warn(
        "decision-unverified",
        `decision ledger query failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  return checks;
}

async function main(): Promise<number> {
  if (MEMORY_BUDGET) {
    printMemoryBudget(logger);
    return 0;
  }

  const argv = Bun.argv.slice(2);
  const projectRoot = await resolveProjectRoot();

  if (argv[0] === "workspace") {
    const sub = argv[1];
    if (!sub || sub === "--help" || sub === "-h") {
      const { printWorkspaceHelp } = await import("../lib/workspace-commands.ts");
      printWorkspaceHelp(logger);
      return sub ? 0 : 1;
    }
    return runWorkspaceCommand(sub, argv.slice(2), projectRoot, logger);
  }

  if (WORKSPACE_ONLY) {
    return runWorkspaceMode(projectRoot);
  }

  if (ECOSYSTEM) {
    if (!JSON_OUT) {
      logger.banner("Kimi Doctor — Ecosystem Health");
    }
    return runEcosystemMode(projectRoot);
  }

  if (AGENT_READY) {
    return runAgentReadyMode(projectRoot);
  }

  if (SUCCESS_METRICS) {
    return runSuccessMetricsMode(projectRoot);
  }

  if (TREND) {
    return runTrendMode();
  }

  if (!JSON_OUT) {
    logger.banner("Kimi Doctor — Toolchain Diagnostics");
  }

  const results: CheckResult[] = [];
  let syncReport: { synced: boolean; drifted: string[]; missing: string[] } | undefined;
  const home = homeDir();

  logger.section("System");
  const systemChecks = await runSystemChecks(logger, {
    softSystem: SOFT_SYSTEM,
    memoryBudgetOnly: false,
  });
  if (!JSON_OUT) {
    for (const check of systemChecks) {
      logger.check(check);
    }
  }
  results.push(...systemChecks);

  logger.section("Kimi Products");

  const kimiPath = Bun.which("kimi");
  if (kimiPath) {
    try {
      const version = await $`kimi --version`.quiet();
      results.push(ok("kimi-code", `${version.stdout.toString().trim()} (${kimiPath})`));
    } catch {
      results.push(ok("kimi-code", `installed (${kimiPath})`));
    }
  } else {
    results.push(
      error("kimi-code", "not found — curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash")
    );
  }

  logger.section("Kimi Code Config");
  const officialKimiDoctorResult = await runOfficialKimiDoctor();
  if (!JSON_OUT) {
    logger.check({
      name: officialKimiDoctorResult.name,
      status: officialKimiDoctorResult.status,
      message: officialKimiDoctorResult.message,
      fixable: false,
    });
  }
  results.push(officialKimiDoctorResult);
  if (!JSON_OUT) {
    logger.info("kimi doctor (official) ≠ kimi-doctor (toolchain)");
  }

  logger.section("Version Matrix");
  results.push(...(await versionMatrix()));

  logger.section("Runtime Sync");
  const syncCheck = await checkDesktopSync(projectRoot);
  results.push(...syncCheck.results);
  syncReport = syncCheck.drift;

  logger.section("MCP");
  const mcpReport = await validateMcpConfig(home, projectRoot);
  const unifiedShellRegistered = mcpReport.checks.some(
    (c) => c.name === "unified-shell" && c.status === "ok"
  );
  for (const check of mcpReport.checks) {
    if (check.status === "ok") results.push(ok(check.name, check.message));
    else if (check.status === "warn") results.push(warn(check.name, check.message));
    else results.push(error(check.name, check.message));
  }

  logger.section("Kimi Permissions");
  const configAudit = await auditKimiConfig(home, { unifiedShellRegistered });
  for (const check of configAudit) {
    if (check.status === "ok") results.push(ok(check.name, check.message));
    else if (check.status === "warn") results.push(warn(check.name, check.message));
    else results.push(error(check.name, check.message));
  }

  logger.section("Code Quality");
  results.push(...(await runQualityChecks(projectRoot)));
  if (QUICK && !JSON_OUT) {
    logger.line("  ⚡ Quick mode — config checks only; run without --quick to execute gates.");
  }

  logger.section("Success Metrics");
  const successMetrics = await auditSuccessMetrics(projectRoot);
  for (const check of successMetrics.checks) {
    if (check.status === "ok") results.push(ok(check.name, check.message));
    else if (check.status === "warn") results.push(warn(check.name, check.message));
    else results.push(error(check.name, check.message));
  }

  logger.section("Capabilities");
  let capabilities: CapabilityReport | undefined;
  capabilities = await capabilityReport(projectRoot);
  for (const check of capabilities.checks) {
    const message = `${check.summary} (${check.latencyMs}ms)`;
    if (check.status === "healthy") results.push(ok(check.id, message));
    else if (check.status === "degraded") results.push(warn(check.id, message));
    else results.push(error(check.id, message));
  }

  logger.section("Self-Healing");
  let selfHealing: HealPlan | undefined;
  selfHealing = await buildHealPlan(projectRoot, { capabilities });
  if (selfHealing.actions.length === 0) {
    results.push(ok("heal-plan", "no local healing actions surfaced"));
  } else {
    const summary = selfHealing.summary;
    const message = `${summary.autoApplicable} safe auto-apply, ${summary.manual} manual, ${summary.blocked} blocked — run kimi-heal plan`;
    results.push(warn("heal-plan", message));
  }

  logger.section("Decision Ledger");
  results.push(...(await runDecisionLedgerChecks(QUICK)));

  logger.section("Toolchain Health");

  if (QUICK) {
    if (!JSON_OUT) {
      logger.warn("Quick mode — skipping individual tool doctors.");
      logger.info("Run without --quick for full toolchain health check.");
    }
  } else {
    const tools = [
      "kimi-guardian",
      "kimi-governance",
      "kimi-context-gen",
      "kimi-fix",
      "kimi-memory",
      "kimi-resource-governor",
      "kimi-debug",
      "kimi-snapshot",
      "kimi-release",
      "kimi-githooks",
    ];

    const cmd = FIX ? "fix" : "doctor";
    const specs = tools.map((tool) => ({
      tool,
      args: tool === "kimi-fix" ? (FIX ? [projectRoot] : ["doctor", projectRoot]) : [cmd],
    }));

    const subChecks = await Effect.runPromise(
      runSubDoctorsEffect({ projectRoot, specs, quick: QUICK, logger })
    );
    results.push(
      ...subChecks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
        category: c.category,
        autoFix: c.autoFix,
        taxonomyId: c.category,
      }))
    );
  }

  logger.section("Path Alignment");
  const pathReport = await auditWorkspaceHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    home,
  });
  for (const check of pathReport.checks) {
    const status =
      STRICT_WORKSPACE && WORKSPACE_SOFT_NAMES.has(check.name) && check.status === "warn"
        ? "error"
        : check.status;
    if (status === "ok") results.push(ok(check.name, check.message));
    else if (status === "warn") results.push(warn(check.name, check.message));
    else results.push(error(check.name, check.message));
  }

  logger.section("Global Context");

  results.push(
    existsSync(join(home, ".kimi-code", "AGENTS.md"))
      ? ok("global-AGENTS.md", "present")
      : error("global-AGENTS.md", "missing")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "UNIFIED.md"))
      ? ok("UNIFIED.md", "present")
      : error("UNIFIED.md", "missing")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "TEMPLATES.md"))
      ? ok("TEMPLATES.md", "present")
      : warn("TEMPLATES.md", "missing")
  );

  logger.section("PATH");

  const pathEntries = (Bun.env.PATH || "").split(":");
  const kimiIdx = pathEntries.findIndex((p) => p.includes("kimi-code"));
  const bunIdx = pathEntries.findIndex((p) => p.includes(".bun/bin"));

  results.push(
    kimiIdx === 0
      ? ok("kimi-code/bin", "#1 in PATH")
      : warn("kimi-code/bin", `#${kimiIdx + 1} in PATH`)
  );
  results.push(
    bunIdx === 1 ? ok("bun/bin", "#2 in PATH") : warn("bun/bin", `#${bunIdx + 1} in PATH`)
  );

  logger.section("Legacy");
  results.push(
    existsSync(join(home, ".kimi"))
      ? warn("~/.kimi", "deprecated — run: kimi migrate")
      : ok("~/.kimi", "gone")
  );
  results.push(
    existsSync(join(home, ".kimi-code", "bin", "kimi.bak"))
      ? warn("kimi.bak", "stale upgrade backup — safe to delete")
      : ok("kimi.bak", "gone")
  );

  const doctorPath = Bun.which("kimi-doctor");
  if (doctorPath?.includes(".local/bin")) {
    try {
      const head = await Bun.file(doctorPath).text();
      if (
        head.includes(".kimi-code/tools/kimi-doctor.ts") ||
        head.includes(".kimi-code/tools/kimi-toolchain.ts")
      ) {
        results.push(ok("kimi-doctor wrapper", "thin exec → ~/.kimi-code/tools/"));
      } else {
        results.push(
          warn("kimi-doctor wrapper", "legacy bash script — run: bun run install-wrappers")
        );
      }
    } catch {
      results.push(warn("kimi-doctor wrapper", "could not read"));
    }
  }

  logger.section("Node Ecosystem");

  const bunPath = Bun.which("bun");
  results.push(bunPath ? ok("bun", Bun.version) : error("bun", "not found"));

  for (const cmd of ["node", "npm", "pnpm", "yarn"]) {
    const p = Bun.which(cmd);
    if (p) {
      try {
        const proc = Bun.spawn([cmd, "--version"], { stdout: "pipe", stderr: "pipe" });
        const out = await Bun.readableStreamToText(proc.stdout);
        results.push(ok(cmd, out.trim()));
      } catch {
        results.push(ok(cmd, "installed"));
      }
    } else {
      logger.line(`  ○ ${cmd}: not installed`);
    }
  }

  if (FIX) {
    await applyFixes(projectRoot);
  }

  const { blocking, system, total: errors } = countBlockingErrors(results, SOFT_SYSTEM);
  const warnings = results.filter((r) => r.status === "warn").length;

  const doctorWarnings = results
    .filter((r) => r.status === "warn" || r.status === "error")
    .map((r) => ({
      check: r.name,
      message: r.message,
      severity: r.status as "warn" | "error",
      taxonomyId: r.taxonomyId || r.category,
    }));

  let gitHead = "";
  try {
    const result = await $`git rev-parse HEAD`.cwd(projectRoot).nothrow().quiet();
    gitHead = result.stdout.toString().trim();
  } catch {
    /* ignore */
  }
  recordDoctorRun(
    await getProjectName(projectRoot),
    "kimi-doctor",
    doctorWarnings,
    undefined,
    gitHead || undefined
  );

  if (JSON_OUT) {
    emitJson({
      toolchainVersion: TOOLCHAIN_VERSION,
      checks: results,
      capabilities,
      selfHealing,
      sync: syncReport,
      summary: {
        errors,
        blockingErrors: blocking,
        systemErrors: system,
        warnings,
        ok: blocking === 0,
        softSystem: SOFT_SYSTEM,
      },
    });
  } else {
    logger.section("Summary");

    if (blocking > 0) {
      logger.error(`${blocking} blocking issue(s) found`);
    } else if (errors > 0 && SOFT_SYSTEM) {
      logger.warn(`${system} system issue(s) found (non-blocking with --soft-system)`);
    } else if (warnings > 0) {
      logger.warn(`${warnings} warning(s) found`);
    } else {
      logger.info("All checks passed");
    }

    if (FIX) {
      logger.info("Auto-fix applied where possible.");
    } else if (QUICK) {
      logger.info("Quick mode — run without --quick for full check.");
    } else if (!isAgentContext()) {
      logger.info("Run with --fix to apply tool fixes, --quick to skip tool doctors.");
      logger.info("Run with --memory-budget to print per-app RSS breakdown.");
      logger.info("Run with --json for structured agent output.");
      logger.info("Run with --workspace for workspace-only checks.");
      logger.info("Run with --ecosystem for cross-product health.");
      logger.info("Run with --fix --fix-cursor to remove legacy Cursor slugs.");
    }
  }

  return blocking > 0 ? 1 : 0;
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      new CliError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }),
  { toolName: "kimi-doctor", logger }
);
process.exit(exitCode);
