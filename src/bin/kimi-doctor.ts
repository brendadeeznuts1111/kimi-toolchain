#!/usr/bin/env bun
import { readableStreamToText } from "../lib/bun-utils.ts";
import { pathExists } from "../lib/bun-io.ts";
import { spawnBun, withBunNoOrphans } from "../lib/tool-runner.ts";
import { withNoOrphansEnv } from "../lib/bun-spawn-env.ts";
/**
 * kimi-doctor — Comprehensive diagnostics
 * Delegates to individual tool doctor commands + runs system checks
 * Usage: kimi-doctor [--fix] [--quick] [--soft-system] [--memory-budget] [--json]
 */

import { $ } from "bun";
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
  type WorkspaceKnownContext,
  WORKSPACE_SOFT_NAMES,
} from "../lib/workspace-health.ts";
import {
  enrichWorkspaceReportWithDecisions,
  formatKnownWorkspaceSuffix,
  recordWorkspaceKnownBlockers,
} from "../lib/workspace-known-blockers.ts";
import { auditEcosystemHealth } from "../lib/ecosystem-health.ts";
import {
  generateOptimizerDoctorRecommendationsEffect,
  formatOptimizerDoctorHealthMessage,
  optimizerRecommendationToMachineCheck,
  optimizerRecommendationsToJson,
  printConstantOptimizerRecommendationsBlock,
  summarizeOptimizerDoctorBlock,
  type OptimizerDoctorJsonRecommendation,
  type OptimizerDoctorRecommendation,
} from "../lib/constant-optimizer.ts";
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
import { generateAgentDiagnosisReport } from "../lib/agent-diagnosis.ts";
import { aggregateChecks, type HealthCheck } from "../lib/health-check.ts";
import { createCli } from "../lib/cli-contract.ts";
import {
  appendEffectGatesSnapshot,
  buildEffectGatesReport,
  deriveSessionCountsFromSnapshots,
  detectRegressions,
  evaluateSessionFloor,
  type EffectGatesCounts,
  readEffectGatesSnapshots,
  type SessionFloorCounts,
} from "../lib/effect-gates.ts";
import {
  formatDashboardMetaDiscoveryStatusLine,
  resolveRemoteHostsConfigured,
  runDashboardMetaGate,
} from "../lib/herdr-dashboard-meta-gate.ts";
import {
  formatDashboardAutomationGateStatusLine,
  resolveDashboardAutomationUrl,
  runDashboardAutomationGate,
} from "../lib/herdr-dashboard-automation-gate.ts";
import { DOCTOR_WATCH_DEFAULT_INTERVAL_SECONDS, runDoctorWatchLoop } from "../lib/doctor-watch.ts";
import { runSubDoctorsEffect } from "../lib/doctor-pipeline.ts";
import { recordDoctorRun } from "../lib/doctor-runs.ts";
import { buildDoctorProbeManifest } from "../lib/doctor-probe.ts";
import { runDoctorPluginsEffect } from "../lib/doctor-plugins.ts";
import {
  listExternalToolAdapters,
  runExternalToolAdapterEffect,
} from "../lib/external-tool-runner.ts";
import { filterLowQualityDecisions, filterUnverifiedDecisions } from "../lib/decision-scoring.ts";
import { readDecisions, resolveDecisionsRoot } from "../lib/decision-ledger.ts";
import { buildBoundConstantIndex } from "../lib/taxonomy-constants.ts";
import {
  HEALTH_SNAPSHOT_SCHEMA_VERSION,
  appendHealthSnapshot,
  computeDecisionVelocity,
  correlateHealthWithConstants,
  detectAnomalies,
  parsePredictiveWindow,
  predictThresholdBreach,
  readHealthSnapshots,
  type HealthSnapshot,
} from "../lib/predictive-doctor.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { toolStart, toolDone, healthResult } from "../lib/health-channel.ts";

const writer = createCli(Bun.argv, "kimi-doctor");
const logger = writer.logger;

const TOOLS_DIR = toolsDir();
const FIX = Bun.argv.includes("--fix");
const QUICK = Bun.argv.includes("--quick");
const SOFT_SYSTEM = Bun.argv.includes("--soft-system");
const MEMORY_BUDGET = Bun.argv.includes("--memory-budget");
const JSON_OUT = writer.flags.json;
const HTML_OUT = Bun.argv.includes("--html");
const WORKSPACE_ONLY = Bun.argv.includes("--workspace");
const ECOSYSTEM = Bun.argv.includes("--ecosystem");
const AGENT_READY = Bun.argv.includes("--agent-ready");
const SUCCESS_METRICS = Bun.argv.includes("--success-metrics");
const AGENT = Bun.argv.includes("--agent");
const FIX_CURSOR = Bun.argv.includes("--fix-cursor");
const FIX_DEEP = Bun.argv.includes("--fix-deep");
const STRICT_WORKSPACE = Bun.argv.includes("--strict-workspace");
const HISTORY = Bun.argv.includes("--history");
const ANOMALY = Bun.argv.includes("--anomaly");
const VELOCITY = Bun.argv.includes("--velocity");
const PREDICT = Bun.argv.includes("--predict");
const CORRELATE = Bun.argv.includes("--correlate");
const EFFECT_GATES = Bun.argv.includes("--effect-gates");
const BUNDLE_GATE = Bun.argv.includes("--bundle");
const COMPILE_CHECK = Bun.argv.includes("--compile-check");
const DASHBOARD_META = Bun.argv.includes("--dashboard-meta");
const DASHBOARD_META_STRICT = DASHBOARD_META && Bun.argv.includes("--strict");
const DASHBOARD_AUTOMATION = Bun.argv.includes("--automation");
const HAS_EFFECT_FLOOR = Bun.argv.includes("--effect-floor");
const HAS_LEGACY_SESSION_REPORT = Bun.argv.includes("--session-report");
if (HAS_LEGACY_SESSION_REPORT && !HAS_EFFECT_FLOOR) {
  process.stderr.write("[deprecated] --session-report is renamed to --effect-floor\n");
}
const EFFECT_FLOOR = HAS_EFFECT_FLOOR || HAS_LEGACY_SESSION_REPORT;
const WORKSPACE_CONTEXT = Bun.argv.includes("--workspace-context");
const WORKSPACE_CONTEXT_BRIEF = Bun.argv.includes("--brief");
const WRITE_CONTEXT_FILES = Bun.argv.includes("--write-context-files");
const WATCH = Bun.argv.includes("--watch");
const PROBE = Bun.argv.includes("--probe");
const MCP_SERVER = Bun.argv.includes("--mcp-server");
const ALL = Bun.argv.includes("--all");
const AGENT_ID = argValue("--agent-id");
const ADAPTER = argValue("--adapter");
const PLUGIN = argValue("--plugin");

function argValue(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = Bun.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** Agent/programmatic JSON output (--json); bypasses Logger formatting. */
function emitJson(data: unknown): void {
  writer.writeJson(data);
}

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  category?: string;
  autoFix?: string;
  taxonomyId?: string;
  known?: WorkspaceKnownContext;
  optimizerRecommendations?: OptimizerDoctorJsonRecommendation[];
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
import { renderMarkdownHtml } from "../lib/bun-markdown.ts";
import { runBundleGate } from "../lib/bundle-gate.ts";
import { probeCompileCapabilities, runCompileGate } from "../lib/compile-target.ts";

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

  if (pathExists(syncScript)) {
    if (!JSON_OUT) logger.line("  → Running bun run sync...");
    if (JSON_OUT) {
      await spawnBun(["run", syncScript], { cwd: projectRoot });
    } else {
      const proc = Bun.spawn(withBunNoOrphans(["bun", "run", syncScript]), {
        cwd: projectRoot,
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    }
  }

  if (pathExists(wrapperScript)) {
    if (!JSON_OUT) logger.line("  → Installing PATH wrappers...");
    const proc = Bun.spawn(["bash", wrapperScript], {
      cwd: projectRoot,
      stdout: JSON_OUT ? "pipe" : "inherit",
      stderr: JSON_OUT ? "pipe" : "inherit",
      env: withNoOrphansEnv(),
    });
    await proc.exited;
  }
}

async function runScript(projectRoot: string, script: string, label: string): Promise<CheckResult> {
  try {
    const result = await spawnBun(["run", script], { cwd: projectRoot });
    if (result.exitCode === 0) return ok(label, "passed");
    const detail =
      result.stderr
        .split("\n")
        .find((l) => l.trim())
        ?.slice(0, 80) || `exit ${result.exitCode}`;
    return error(label, detail);
  } catch (e: unknown) {
    return error(label, e instanceof Error ? e.message : String(e));
  }
}

async function runQualityChecks(projectRoot: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const pkgPath = join(projectRoot, "package.json");
  if (!pathExists(pkgPath)) {
    return [warn("quality", "no package.json in project root")];
  }

  results.push(
    pathExists(join(projectRoot, ".oxfmtrc.json"))
      ? ok("oxfmtrc", "present")
      : warn("oxfmtrc", "missing — run kimi-fix")
  );
  results.push(
    pathExists(join(projectRoot, ".oxlintrc.json"))
      ? ok("oxlintrc", "present")
      : warn("oxlintrc", "missing — run kimi-fix")
  );

  results.push(
    pathExists(join(projectRoot, "AGENTS.md"))
      ? ok("project-AGENTS.md", "present")
      : warn("project-AGENTS.md", "missing — run kimi-fix")
  );

  results.push(
    pathExists(join(projectRoot, ".kimi-code", "mcp.json"))
      ? ok("project-mcp.json", "present")
      : warn("project-mcp.json", "missing — run kimi-fix")
  );

  results.push(
    pathExists(join(projectRoot, "scripts", "check.ts"))
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
  if (pathExists(govPath)) {
    if (!JSON_OUT) logger.line("  → Running kimi-resource-governor fix...");
    await spawnBun(["run", govPath, "fix"]);
  }

  if (await isKimiToolchainRepo(projectRoot)) {
    let pathReport = await auditWorkspaceHealth(projectRoot);
    await recordWorkspaceKnownBlockers(projectRoot, pathReport.checks);
    pathReport = await enrichWorkspaceReportWithDecisions(pathReport, projectRoot);
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
  let report = await auditWorkspaceHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    home,
  });
  await recordWorkspaceKnownBlockers(projectRoot, report.checks);
  report = await enrichWorkspaceReportWithDecisions(report, projectRoot);
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

  const healthReport = aggregateChecks(
    "kimi-doctor",
    report.checks.map((check) => ({
      ...check,
      message: `${check.message}${formatKnownWorkspaceSuffix(check)}`,
    }))
  );
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
  const optimizerRecs = await Effect.runPromise(runOptimizerCheck(projectRoot));
  const optimizerRecommendations = optimizerRecommendationsToJson(optimizerRecs);
  const gitHead = await resolveGitHead(projectRoot);
  await appendHealthSnapshot(projectRoot, {
    checks: report.checks.map((check) => ({
      name: `${check.source}/${check.name}`,
      status: check.status,
      message: check.message,
      fixable: check.fixable,
    })),
    ecosystem: {
      blockers: report.blockers,
      warnings: report.warnings,
      errors: report.errors,
    },
    gitHead,
  });

  if (JSON_OUT) {
    emitJson({
      checks: report.checks,
      optimizerChecks: optimizerRecs.map(optimizerRecommendationToMachineCheck),
      optimizerRecommendations,
      ecosystem: {
        blockers: report.blockers,
        warnings: report.warnings,
        errors: report.errors,
      },
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
  printConstantOptimizerRecommendationsBlock(logger, optimizerRecs);

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

function runOptimizerCheck(projectRoot: string): Effect.Effect<OptimizerDoctorRecommendation[]> {
  return Effect.tryPromise({
    try: () => isKimiToolchainRepo(projectRoot),
    catch: () => "optimizer-repo-detect-failed",
  }).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.flatMap((isToolchain) =>
      isToolchain ? generateOptimizerDoctorRecommendationsEffect(projectRoot) : Effect.succeed([])
    )
  );
}

async function resolveGitHead(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await $`git rev-parse HEAD`.cwd(projectRoot).nothrow().quiet();
    const head = result.stdout.toString().trim();
    return head || undefined;
  } catch {
    return undefined;
  }
}

function sparkline(snapshots: HealthSnapshot[]): string {
  const ticks = "▁▂▃▄▅▆▇█";
  if (snapshots.length === 0) return "";
  return snapshots
    .map(
      (snapshot) =>
        ticks[Math.min(ticks.length - 1, Math.max(0, Math.floor(snapshot.score / 12.5)))]
    )
    .join("");
}

function parseWindowFlag(flag: string, fallback: string): number {
  return parsePredictiveWindow(argValue(flag) ?? fallback);
}

function parseHorizonHours(): number {
  const raw = argValue("--horizon") ?? "6h";
  const ms = parsePredictiveWindow(raw);
  return Math.max(1, Math.round((ms / 3_600_000) * 100) / 100);
}

async function runPredictiveMode(projectRoot: string): Promise<number> {
  const payload: Record<string, unknown> = {
    schemaVersion: HEALTH_SNAPSHOT_SCHEMA_VERSION,
    tool: "kimi-doctor",
  };
  let exitCode = 0;

  if (HISTORY) {
    const windowLabel = argValue("--history") ?? "7d";
    const snapshots = await readHealthSnapshots(projectRoot, {
      windowMs: parsePredictiveWindow(windowLabel),
    });
    payload.history = {
      window: windowLabel,
      count: snapshots.length,
      sparkline: sparkline(snapshots),
      snapshots,
    };
    if (!JSON_OUT) {
      logger.section(`Health History (${windowLabel})`);
      if (snapshots.length === 0) logger.info("No health snapshots yet");
      else {
        logger.line(`  ${sparkline(snapshots)}  ${snapshots.length} snapshot(s)`);
        for (const snapshot of snapshots.slice(-10)) {
          logger.line(
            `  ${snapshot.timestamp.slice(0, 19)} score=${snapshot.score} warn=${snapshot.summary.warn} error=${snapshot.summary.error} drift=${snapshot.activeDriftCount}`
          );
        }
      }
    }
  }

  if (ANOMALY) {
    const windowMs = parseWindowFlag("--window", "7d");
    const snapshots = await readHealthSnapshots(projectRoot, { windowMs });
    const anomalies = detectAnomalies(snapshots, windowMs);
    payload.anomaly = { count: anomalies.length, anomalies };
    if (anomalies.some((item) => item.severity === "error")) exitCode = 1;
    if (!JSON_OUT) {
      logger.section("Health Anomalies");
      if (anomalies.length === 0) logger.info("No anomalies in window");
      else {
        for (const anomaly of anomalies) {
          const line = `${anomaly.name}: ${anomaly.message} (current=${anomaly.current}, mean=${anomaly.mean}, σ=${anomaly.stddev})`;
          if (anomaly.severity === "error") logger.error(line);
          else logger.warn(line);
        }
      }
    }
  }

  if (VELOCITY) {
    const decisions = await readDecisions(await resolveDecisionsRoot(projectRoot));
    const currentWindowMs = parseWindowFlag("--last", "24h");
    const baselineWindowMs = parseWindowFlag("--baseline", "7d");
    const velocity = computeDecisionVelocity(decisions, currentWindowMs, baselineWindowMs);
    payload.velocity = velocity;
    if (velocity.alert) exitCode = 1;
    if (!JSON_OUT) {
      logger.section("Decision Velocity");
      const detail = `${velocity.currentCount} recent decision(s), ${velocity.baselineCount} baseline decision(s)`;
      if (velocity.alert) logger.warn(`${detail} — investigate config churn`);
      else logger.info(detail);
    }
  }

  if (PREDICT) {
    const horizonHours = parseHorizonHours();
    const snapshots = await readHealthSnapshots(projectRoot, {
      windowMs: parseWindowFlag("--window", "7d"),
    });
    const prediction = predictThresholdBreach(snapshots, { horizonHours });
    payload.predict = prediction;
    if (prediction.status === "breaching" || prediction.status === "predicted") exitCode = 1;
    if (!JSON_OUT) {
      logger.section("Health Prediction");
      if (prediction.status === "breaching" || prediction.status === "predicted") {
        logger.warn(prediction.message);
      } else {
        logger.info(prediction.message);
      }
    }
  }

  if (CORRELATE) {
    const windowMs = parseWindowFlag("--last", "24h");
    const [snapshots, decisions] = await Promise.all([
      readHealthSnapshots(projectRoot, { windowMs }),
      readDecisions(await resolveDecisionsRoot(projectRoot)),
    ]);
    const correlations = correlateHealthWithConstants(snapshots, decisions, {
      lookbackMs: windowMs,
    });
    payload.correlate = { count: correlations.length, correlations };
    if (!JSON_OUT) {
      logger.section("Health Correlation");
      if (correlations.length === 0) logger.info("No constant-linked health drops in window");
      else {
        for (const correlation of correlations) {
          logger.warn(
            `${correlation.fromTimestamp.slice(0, 19)} → ${correlation.toTimestamp.slice(0, 19)} score ${correlation.scoreDelta}`
          );
          for (const decision of correlation.decisions.slice(0, 5)) {
            logger.line(`  ${decision.decisionId} ${decision.type} ${decision.target}`);
          }
        }
      }
    }
  }

  if (JSON_OUT) emitJson(payload);
  return exitCode;
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
        reviewCommand: report.ledger.reviewCommand,
        ...(report.ledger.unknownAction ? { unknownAction: report.ledger.unknownAction } : {}),
        unknownBuckets: report.ledger.unknownBuckets,
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

async function runAgentDiagnosisMode(projectRoot: string): Promise<number> {
  const report = await generateAgentDiagnosisReport(projectRoot);

  if (JSON_OUT) {
    emitJson(report);
    return 0;
  }

  logger.banner("Kimi Doctor — Agent Diagnosis");
  logger.info(`Overall confidence: ${(report.summary.overallConfidence * 100).toFixed(1)}%`);
  logger.info(`Issues: ${report.summary.issueCount} (${report.summary.fixableIssueCount} fixable)`);

  if (report.prioritizedIssues.length > 0) {
    logger.section("Prioritized issues");
    for (const issue of report.prioritizedIssues.slice(0, 12)) {
      logger.check({
        name: issue.name,
        status: issue.status,
        message: issue.message,
        fixable: !!issue.autoFix,
        autoFix: issue.autoFix,
      });
    }
  }

  if (report.proposedActions.length > 0) {
    logger.section("Proposed actions");
    for (const action of report.proposedActions) {
      const cmd = action.command ? ` → ${action.command}` : "";
      logger.info(`${action.title} (${action.expectedImpact})${cmd}`);
      logger.line(`  ${action.rationale}`);
    }
  }

  return 0;
}

async function runEffectGatesMode(projectRoot: string): Promise<number> {
  const [previous] = await readEffectGatesSnapshots(projectRoot, 1);
  const gitHead = await resolveGitHead(projectRoot);
  const current = await buildEffectGatesReport({
    projectRoot,
    tool: "kimi-doctor",
    gitHead,
  });
  const regressions = detectRegressions(current, previous ?? null);
  await appendEffectGatesSnapshot(projectRoot, current);

  const keys = Object.keys(current.counts) as Array<keyof EffectGatesCounts>;
  const delta = Object.fromEntries(
    keys.map((key) => {
      const before = previous?.counts[key] ?? 0;
      return [key, current.counts[key] - before];
    })
  ) as Record<keyof EffectGatesCounts, number>;

  const ok = current.summary.errors === 0 && regressions.length === 0;

  if (JSON_OUT) {
    emitJson({
      effectGates: {
        previous: previous ?? null,
        current,
        delta,
        regressions,
      },
      thresholds: current.thresholds,
      violations: current.violations,
      summary: { ok },
    });
  } else {
    logger.section("Effect Gates");
    logger.info(
      `${current.summary.total} violation(s), ${current.summary.errors} error(s), ${current.summary.warnings} warning(s)`
    );
    if (regressions.length > 0) {
      logger.warn(`${regressions.length} regression(s) detected`);
      for (const regression of regressions) logger.warn(regression.message);
    }
    for (const violation of current.violations) {
      const message = violation.location
        ? `${violation.location}: ${violation.message}`
        : violation.message;
      if (violation.severity === "error") logger.error(message);
      else logger.warn(message);
    }
  }

  return ok ? 0 : 1;
}

async function runBundleGateMode(projectRoot: string): Promise<number> {
  const report = await runBundleGate({ projectRoot });

  if (JSON_OUT) {
    emitJson({ bundleGate: report });
  } else {
    logger.section("Bundle Analysis");
    if (report.error) {
      logger.line(`  ✗ ${report.error}`);
      return 1;
    }

    const summary = report.summary;
    if (summary) {
      const totalMB = (summary.totalBytes / (1024 * 1024)).toFixed(1);
      logger.line(
        `  Total: ${totalMB} MB | ${summary.inputModules} modules | ${summary.entryPoints} entry point(s)`
      );
      logger.line(
        `  node_modules: ${summary.nodeModulesFiles} files (${(summary.nodeModulesBytes / (1024 * 1024)).toFixed(1)} MB)`
      );
    }

    if (report.largestModules.length > 0) {
      logger.line("");
      logger.line("  Largest modules:");
      for (const m of report.largestModules.slice(0, 5)) {
        const mb = (m.outputBytes / (1024 * 1024)).toFixed(2);
        const shortPath = m.module.length > 60 ? "…" + m.module.slice(-56) : m.module;
        logger.line(`    ${m.pctOfTotal.toFixed(1)}%  ${mb} MB  ${shortPath}`);
      }
    }

    if (report.findings.length > 0) {
      logger.line("");
      logger.line("  Findings:");
      for (const f of report.findings) {
        const icon = f.severity === "error" ? "✗" : f.severity === "warn" ? "⚠" : "ℹ";
        logger.line(`    ${icon} [${f.rule}] ${f.message}`);
      }
    }

    logger.line("");
    logger.line(report.ok ? "  ✓ Bundle gate passed" : "  ✗ Bundle gate failed");
  }

  return report.ok ? 0 : 1;
}

async function runCompileCheckMode(projectRoot: string): Promise<number> {
  const caps = await probeCompileCapabilities();
  const gate = await runCompileGate(projectRoot);

  if (JSON_OUT) {
    emitJson({ compileCheck: { capabilities: caps, gate } });
  } else {
    logger.section("Compile Check");
    logger.line(`  Bun: ${caps.bunVersion} (${caps.bunRevision})`);
    logger.line(
      `  ESM + bytecode: ${caps.esmBytecode ? "✓ supported" : "✗ not supported (Bun < 1.3.9)"}`
    );
    logger.line(`  Recommended format: ${caps.recommendedFormat}`);
    logger.line(
      `  CPU prof interval: ${caps.cpuProfInterval ? "✓ supported (--cpu-prof-interval=N)" : "✗ not supported (Bun < 1.3.7)"}`
    );
    logger.line(
      `  Profiling: cpu-prof-md ${caps.cpuProfMd ? "✓" : "✗"} | heap-prof ${caps.heapProf ? "✓" : "✗"} | heap-prof-md ${caps.heapProfMd ? "✓" : "✗"}`
    );

    if (gate.status !== "ok") {
      logger.line("");
      for (const m of gate.messages) {
        logger.line(`  ${gate.status === "error" ? "✗" : "⚠"} ${m}`);
      }
    } else {
      for (const m of gate.messages) logger.line(`  ✓ ${m}`);
    }
  }

  return gate.status === "error" ? 1 : 0;
}

async function runDashboardMetaMode(): Promise<number> {
  const urlOverride = argValue("--dashboard-url");
  const result = await runDashboardMetaGate({ url: urlOverride, strict: DASHBOARD_META_STRICT });
  const ok = result.ok;

  if (JSON_OUT) {
    emitJson({
      dashboardMeta: result,
      summary: { ok, strict: DASHBOARD_META_STRICT },
    });
  } else {
    logger.section("Dashboard Meta");
    if (ok && result.discovery) {
      const d = result.discovery;
      const remoteSuffix = DASHBOARD_META_STRICT
        ? ` · remoteHosts ${d.remoteHosts?.reachable ?? 0}/${resolveRemoteHostsConfigured(d)} reachable`
        : "";
      logger.info(`${result.url} · ${formatDashboardMetaDiscoveryStatusLine(d)}${remoteSuffix}`);
    } else if (result.discovery && result.failure?.detail) {
      logger.error(`${result.url} · ${formatDashboardMetaDiscoveryStatusLine(result.discovery)}`);
      logger.error(`  ${result.failure.detail}`);
    } else {
      logger.error(result.failure?.message ?? "dashboard meta gate failed");
      if (result.discovery) {
        logger.info(
          `partial discovery: resolution=${String(result.discovery.workspaceIdResolution)} count=${String(result.discovery.workspaceCandidateCount)}`
        );
      }
    }
  }

  return ok ? 0 : 1;
}

async function runDashboardAutomationMode(projectRoot: string): Promise<number> {
  const urlOverride = argValue("--url") ?? argValue("--dashboard-url");
  const result = await runDashboardAutomationGate({
    url: urlOverride,
    projectPath: projectRoot,
  });
  const ok = result.ok;

  if (JSON_OUT) {
    emitJson({
      dashboardAutomation: result,
      summary: { ok },
    });
  } else {
    logger.section("Dashboard Automation");
    if (ok) {
      logger.info(formatDashboardAutomationGateStatusLine(result));
    } else if (result.failure?.detail) {
      logger.error(result.failure.message);
      logger.error(`  ${result.failure.detail}`);
    } else {
      logger.error(result.failure?.message ?? "dashboard automation gate failed");
    }
    if (result.ownedServer) {
      logger.info("mode: self-contained (ephemeral server + WebView smoke + thumbnail feed)");
    } else if (urlOverride ?? resolveDashboardAutomationUrl()) {
      logger.info(`mode: external (${result.url})`);
    }
  }

  return ok ? 0 : 1;
}

function parseSessionReportFlag(flag: string): number | undefined {
  const raw = argValue(flag);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

const SESSION_REPORT_FLAGS = [
  "--raw-promises-removed",
  "--services-migrated",
  "--domain-purity-resolved",
  "--raw-errors-converted",
  "--event-emitters-converted",
  "--circular-layers",
] as const;

function sessionReportUsesManualFlags(): boolean {
  return SESSION_REPORT_FLAGS.some((flag) => Bun.argv.includes(flag));
}

async function runEffectFloorMode(projectRoot: string): Promise<number> {
  let counts: Partial<SessionFloorCounts>;
  let source: "manual" | "effect-gates-snapshots" = "manual";

  if (sessionReportUsesManualFlags()) {
    counts = {
      rawPromisesRemoved: parseSessionReportFlag("--raw-promises-removed"),
      servicesMigratedToTagLayer: parseSessionReportFlag("--services-migrated"),
      domainPurityViolationsResolved: parseSessionReportFlag("--domain-purity-resolved"),
      rawErrorsConvertedToTyped: parseSessionReportFlag("--raw-errors-converted"),
      eventEmittersConvertedToStreams: parseSessionReportFlag("--event-emitters-converted"),
      circularLayerDependencies: parseSessionReportFlag("--circular-layers"),
    };
  } else {
    return runEffectFloorAutoMode(projectRoot);
  }

  const invalid: string[] = [];
  for (const [field, raw] of Object.entries(counts)) {
    if (raw === undefined) invalid.push(field);
    else if (!Number.isInteger(raw) || raw < 0) invalid.push(field);
  }

  if (invalid.length > 0) {
    const message = `Missing or invalid session-floor field(s): ${invalid.join(", ")}`;
    if (JSON_OUT) {
      emitJson({
        schemaVersion: 1,
        tool: "kimi-doctor",
        source,
        counts,
        error: message,
        summary: { passed: false, missing: invalid, below: [] },
      });
    } else {
      logger.error(message);
    }
    return 1;
  }

  const floor = evaluateSessionFloor(counts as SessionFloorCounts);

  if (JSON_OUT) {
    emitJson({
      schemaVersion: 1,
      tool: "kimi-doctor",
      source,
      counts,
      floor,
      summary: {
        passed: floor.passed,
        missing: floor.missing,
        below: floor.below,
      },
    });
  } else {
    logger.section("Effect Floor");
    if (floor.passed) {
      logger.info("Effect floor passed");
    } else {
      logger.error("Session floor failed");
      for (const field of floor.missing) logger.error(`Missing field: ${field}`);
      for (const field of floor.below) logger.error(`Below floor: ${field}`);
      for (const detail of floor.details) {
        if (detail.actual < detail.floor || Number.isNaN(detail.actual)) {
          logger.line(`  ${detail.field}: ${detail.actual} (floor ${detail.floor})`);
        }
      }
    }
  }

  return floor.passed ? 0 : 1;
}

async function runWorkspaceContextMode(projectRoot: string): Promise<number> {
  const { buildWorkspaceContextReport, writeWorkspaceContextJsonFile } =
    await import("../lib/doctor-workspace-context.ts");
  const report = await buildWorkspaceContextReport({
    projectRoot,
    brief: WORKSPACE_CONTEXT_BRIEF,
  });

  if (JSON_OUT || WRITE_CONTEXT_FILES) {
    writeWorkspaceContextJsonFile(report);
  }

  if (JSON_OUT) {
    if (HTML_OUT) {
      report.html = renderMarkdownHtml(report.markdown);
    }
    emitJson(report);
  } else if (HTML_OUT) {
    process.stdout.write(renderMarkdownHtml(report.markdown));
  } else {
    process.stdout.write(report.markdown);
  }

  return 0;
}

async function runEffectFloorAutoMode(projectRoot: string): Promise<number> {
  const source = "effect-gates-auto";
  const [previous] = await readEffectGatesSnapshots(projectRoot, 1);
  const current = await buildEffectGatesReport({ projectRoot, tool: "kimi-doctor" });
  const regressionRows = detectRegressions(current, previous ?? null);
  const gatesOk = current.summary.errors === 0 && regressionRows.length === 0;

  const snapshots = await readEffectGatesSnapshots(projectRoot, 50);
  const derived = snapshots.length >= 2 ? deriveSessionCountsFromSnapshots(snapshots) : null;
  const floor = derived ? evaluateSessionFloor(derived) : null;
  const passed = gatesOk && (floor?.passed ?? true);

  if (JSON_OUT) {
    emitJson({
      schemaVersion: 1,
      tool: "kimi-doctor",
      source,
      effectGates: {
        current,
        regressions: regressionRows,
        summary: { ok: gatesOk },
      },
      counts: derived,
      floor,
      summary: {
        passed,
        missing: floor?.missing ?? [],
        below: floor?.below ?? [],
      },
    });
  } else {
    logger.section("Effect Floor");
    logger.line("Auto mode: current effect-gates scan + snapshot floor when history exists");
    if (!gatesOk) {
      logger.error("Effect gates failed");
      for (const regression of regressionRows) logger.error(regression.message);
      for (const violation of current.violations) {
        if (violation.severity !== "error") continue;
        const message = violation.location
          ? `${violation.location}: ${violation.message}`
          : violation.message;
        logger.error(message);
      }
    } else if (floor && !floor.passed) {
      logger.error("Session floor failed");
      for (const field of floor.below) logger.error(`Below floor: ${field}`);
    } else {
      logger.info("Effect floor passed");
    }
  }

  return passed ? 0 : 1;
}

interface AllModeSourceSummary {
  adapterName?: string;
  pluginName?: string;
  durationMs: number;
  errorCount: number;
  warnCount: number;
}

interface AllModeSource {
  name: string;
  summary: AllModeSourceSummary;
  checks: HealthCheck[];
}

async function runAllMode(projectRoot: string): Promise<number> {
  const sources: AllModeSource[] = [];
  const rawTimeout = argValue("--timeout");
  const adapterTimeout = rawTimeout ? Number(rawTimeout) : undefined;

  const adapterNames = listExternalToolAdapters();
  for (const name of adapterNames) {
    const output = await Effect.runPromise(
      runExternalToolAdapterEffect(name, projectRoot, {
        timeoutMs: Number.isFinite(adapterTimeout) ? adapterTimeout : undefined,
      })
    );
    sources.push({
      name,
      checks: output.checks,
      summary: {
        adapterName: name,
        durationMs: output.durationMs,
        errorCount: output.checks.filter((c) => c.status === "error").length,
        warnCount: output.checks.filter((c) => c.status === "warn").length,
      },
    });
  }

  const pluginChecks = await Effect.runPromise(
    runDoctorPluginsEffect({ projectRoot, home: homeDir() })
  );
  if (pluginChecks.length > 0) {
    sources.push({
      name: "plugins",
      checks: pluginChecks,
      summary: {
        pluginName: "all",
        durationMs: 0,
        errorCount: pluginChecks.filter((c) => c.status === "error").length,
        warnCount: pluginChecks.filter((c) => c.status === "warn").length,
      },
    });
  }

  const checks = sources.flatMap((s) => s.checks);
  const summary = aggregateChecks("kimi-doctor", checks);
  const sourcesRecord = Object.fromEntries(sources.map((s) => [s.name, s.summary]));

  if (JSON_OUT) {
    emitJson({
      schemaVersion: 1,
      tool: "kimi-doctor",
      mode: "all",
      checks,
      sources: sourcesRecord,
      summary,
    });
  } else {
    logger.banner("Kimi Doctor — All Checks");
    for (const source of sources) {
      logger.section(source.name);
      for (const check of source.checks) {
        logger.check(check);
      }
      logger.info(`${source.summary.errorCount} error(s), ${source.summary.warnCount} warning(s)`);
    }
    logger.section("Summary");
    logger.info(`${summary.errorCount} error(s), ${summary.warnCount} warning(s)`);
  }

  return summary.errorCount > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  if (MEMORY_BUDGET) {
    printMemoryBudget(logger);
    return 0;
  }

  if (PROBE) {
    const probeRoot = await resolveProjectRoot(argValue("--project-root"));
    emitJson(await buildDoctorProbeManifest(probeRoot));
    return 0;
  }

  if (MCP_SERVER) {
    const { startDoctorMcpServer } = await import("../lib/doctor-mcp-server.ts");
    await startDoctorMcpServer();
    return 0;
  }

  const argv = Bun.argv.slice(2);
  const projectRoot = await resolveProjectRoot(argValue("--project-root"));

  if (ADAPTER) {
    const rawTimeout = argValue("--timeout");
    const adapterTimeout = rawTimeout ? Number(rawTimeout) : undefined;
    const output = await Effect.runPromise(
      runExternalToolAdapterEffect(ADAPTER, projectRoot, {
        timeoutMs: Number.isFinite(adapterTimeout) ? adapterTimeout : undefined,
      })
    );
    if (JSON_OUT) {
      emitJson({
        agentId: AGENT_ID,
        mode: "adapter",
        adapter: ADAPTER,
        checks: output.checks,
        durationMs: output.durationMs,
        summary: aggregateChecks(ADAPTER, output.checks),
      });
    } else {
      for (const check of output.checks) logger.check(check);
    }
    return output.checks.some((c) => c.status === "error") ? 1 : 0;
  }

  if (PLUGIN) {
    const checks = await Effect.runPromise(
      runDoctorPluginsEffect({ projectRoot, home: homeDir(), only: PLUGIN })
    );
    if (JSON_OUT) {
      emitJson({
        agentId: AGENT_ID,
        mode: "plugin",
        plugin: PLUGIN,
        checks,
        summary: aggregateChecks(PLUGIN, checks),
      });
    } else {
      for (const check of checks) logger.check(check);
    }
    return checks.some((c) => c.status === "error") ? 1 : 0;
  }

  if (ALL) {
    return runAllMode(projectRoot);
  }

  if (HISTORY || ANOMALY || VELOCITY || PREDICT || CORRELATE) {
    try {
      return await runPredictiveMode(projectRoot);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

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

  if (AGENT) {
    return runAgentDiagnosisMode(projectRoot);
  }

  if (EFFECT_GATES) {
    return runEffectGatesMode(projectRoot);
  }

  if (BUNDLE_GATE) {
    return runBundleGateMode(projectRoot);
  }

  if (COMPILE_CHECK) {
    return runCompileCheckMode(projectRoot);
  }

  if (DASHBOARD_META) {
    return runDashboardMetaMode();
  }

  if (DASHBOARD_AUTOMATION) {
    return runDashboardAutomationMode(projectRoot);
  }

  if (EFFECT_FLOOR) {
    return runEffectFloorMode(projectRoot);
  }

  if (WORKSPACE_CONTEXT) {
    return runWorkspaceContextMode(projectRoot);
  }

  if (WATCH) {
    const rawInterval = argValue("--watch-interval");
    const parsedInterval = rawInterval
      ? Number(rawInterval)
      : DOCTOR_WATCH_DEFAULT_INTERVAL_SECONDS;
    const intervalSeconds = Number.isFinite(parsedInterval)
      ? parsedInterval
      : DOCTOR_WATCH_DEFAULT_INTERVAL_SECONDS;
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      await runDoctorWatchLoop({
        projectRoot,
        intervalSeconds,
        logger,
        json: JSON_OUT,
        signal: controller.signal,
      });
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    return 0;
  }

  if (!JSON_OUT) {
    logger.banner("Kimi Doctor — Toolchain Diagnostics");
  }

  toolStart("kimi-doctor");
  const startTime = Date.now();

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

  logger.section("Toolchain Health");

  if (QUICK) {
    if (!JSON_OUT) {
      logger.warn("Quick mode — skipping individual tool doctors.");
      logger.info("Run without --quick for full toolchain health check.");
      if ((await buildBoundConstantIndex(projectRoot)).size > 0) {
        logger.info("Run --ecosystem --quick for the full constant optimizer health view.");
      }
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
  let pathReport = await auditWorkspaceHealth(projectRoot, {
    strictWorkspace: STRICT_WORKSPACE,
    home,
  });
  await recordWorkspaceKnownBlockers(projectRoot, pathReport.checks);
  pathReport = await enrichWorkspaceReportWithDecisions(pathReport, projectRoot);
  for (const check of pathReport.checks) {
    const message = `${check.message}${formatKnownWorkspaceSuffix(check)}`;
    const status =
      STRICT_WORKSPACE && WORKSPACE_SOFT_NAMES.has(check.name) && check.status === "warn"
        ? "error"
        : check.status;
    const result =
      status === "ok"
        ? ok(check.name, message)
        : status === "warn"
          ? warn(check.name, message)
          : error(check.name, message);
    if (check.known) result.known = check.known;
    results.push(result);
  }

  const optimizerRecs = await Effect.runPromise(runOptimizerCheck(projectRoot));
  const optimizerRecommendations = optimizerRecommendationsToJson(optimizerRecs);
  if (optimizerRecs.length > 0 || (await isKimiToolchainRepo(projectRoot))) {
    const optimizerSummary = summarizeOptimizerDoctorBlock(optimizerRecs);
    const optimizerMessage = formatOptimizerDoctorHealthMessage(optimizerRecs);
    if (!JSON_OUT) {
      printConstantOptimizerRecommendationsBlock(logger, optimizerRecs);
    }
    results.push({
      name: "Optimizer",
      status: optimizerSummary.status,
      message: optimizerMessage,
      optimizerRecommendations,
    });
  }

  logger.section("Global Context");

  results.push(
    pathExists(join(home, ".kimi-code", "AGENTS.md"))
      ? ok("global-AGENTS.md", "present")
      : error("global-AGENTS.md", "missing")
  );
  results.push(
    pathExists(join(home, ".kimi-code", "UNIFIED.md"))
      ? ok("UNIFIED.md", "present")
      : error("UNIFIED.md", "missing")
  );
  results.push(
    pathExists(join(home, ".kimi-code", "TEMPLATES.md"))
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
    pathExists(join(home, ".kimi"))
      ? warn("~/.kimi", "deprecated — run: kimi migrate")
      : ok("~/.kimi", "gone")
  );
  results.push(
    pathExists(join(home, ".kimi-code", "bin", "kimi.bak"))
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
  results.push(bunPath ? ok("bun", `${Bun.version} (${Bun.revision})`) : error("bun", "not found"));

  for (const cmd of ["node", "npm", "pnpm", "yarn"]) {
    const p = Bun.which(cmd);
    if (p) {
      try {
        const proc = Bun.spawn([cmd, "--version"], { stdout: "pipe", stderr: "pipe" });
        const out = await readableStreamToText(proc.stdout);
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

  const gitHead = await resolveGitHead(projectRoot);
  recordDoctorRun(
    await getProjectName(projectRoot),
    "kimi-doctor",
    doctorWarnings,
    undefined,
    gitHead
  );
  await appendHealthSnapshot(projectRoot, {
    checks: results.map((result) => ({
      name: result.name,
      status: result.status,
      message: result.message,
      fixable: false,
      category: result.taxonomyId || result.category,
    })),
    ecosystem:
      QUICK && (await isKimiToolchainRepo(projectRoot))
        ? {
            blockers: blocking,
            warnings,
            errors,
          }
        : undefined,
    gitHead,
  });

  const decisions = await readDecisions(await resolveDecisionsRoot(projectRoot));
  const lowQuality = filterLowQualityDecisions(decisions).slice(0, 5);
  const unverified = filterUnverifiedDecisions(decisions).slice(0, 5);

  if (JSON_OUT) {
    emitJson({
      toolchainVersion: TOOLCHAIN_VERSION,
      checks: results,
      sync: syncReport,
      decisions: {
        total: decisions.length,
        lowQuality: lowQuality.map((d) => ({
          decisionId: d.decisionId,
          qualityScore: d.qualityScore,
          summary: d.rationale.summary,
        })),
        unverified: unverified.map((d) => ({
          decisionId: d.decisionId,
          outcome: d.outcome.result,
          summary: d.rationale.summary,
        })),
      },
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

    if (lowQuality.length > 0 || unverified.length > 0) {
      logger.section("Decision Ledger");
      if (lowQuality.length > 0) {
        logger.warn(`${lowQuality.length} recent low-quality decision(s):`);
        for (const item of lowQuality) {
          logger.line(
            `  ${item.decisionId} score=${item.qualityScore ?? "n/a"} — ${item.rationale.summary}`
          );
        }
      }
      if (unverified.length > 0) {
        logger.info(`${unverified.length} unverified decision(s) — run 'kimi-decision score'`);
      }
    }
  }

  const exitCode = blocking > 0 ? 1 : 0;
  const durationMs = Date.now() - startTime;
  healthResult("kimi-doctor", {
    checks: results.length,
    errors: results.filter((r) => r.status === "error").length,
    warnings: results.filter((r) => r.status === "warn").length,
    durationMs,
  });
  toolDone("kimi-doctor", exitCode, results.filter((r) => r.status === "error").length);

  return exitCode;
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
