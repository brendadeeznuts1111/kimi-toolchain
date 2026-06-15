#!/usr/bin/env bun
/**
 * kimi-resource-governor — Resource limits, parallelism, disk quota, diagnostic cache
 * v2.0: governedSpawn() export, wall-clock enforcement, session auto-track, kimi-doctor cache
 * P1: rlimit tracking, parallelism governor
 * P2: Disk quota, diagnostic cache with TTL
 *
 * Usage:
 *   kimi-resource-governor [limits|parallel|quota|cache|spawn|doctor|session|cleanup|status]
 *
 * Import:
 *   import { governedSpawn, ParallelGovernor, cachedExec, cachedDoctor, getSessionId } from "./kimi-resource-governor.ts";
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot, buildDoctorReport } from "../lib/utils.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { getGovernorConfigPath, DEFAULT_CONFIG_TEMPLATE } from "../lib/governor-config.ts";
import { governorDir } from "../lib/paths.ts";
import { DEFAULTS, ensureDefaultsLoaded } from "../lib/governor-state.ts";
import {
  getSessionId,
  startSession,
  endSession,
  hasSessionId,
  getDb,
  cleanupCache,
} from "../lib/governor-sessions.ts";
import { governedSpawn, getCurrentUsage, checkLimits } from "../lib/governor-spawn.ts";
import { ParallelGovernor } from "../lib/governor-parallel.ts";
import { cachedExec } from "../lib/governor-cache.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger(Bun.argv, "kimi-resource-governor");
const GOVERNOR_DIR = governorDir();
const DB_PATH = join(GOVERNOR_DIR, "resource-cache.sqlite");

// ── Disk Quota ───────────────────────────────────────────────────────

async function getDiskUsage(dir: string): Promise<number> {
  try {
    const result = await governedSpawn(["du", "-sk", dir]);
    const kb = parseInt(result.stdout.split(/\s+/)[0], 10);
    return Math.round(kb / 1024);
  } catch {
    return 0;
  }
}

export async function checkDiskQuota(
  projectDir: string,
  quotaMB = DEFAULTS.diskQuotaMB
): Promise<{ used: number; remaining: number; ok: boolean }> {
  const used = await getDiskUsage(projectDir);
  const remaining = quotaMB - used;
  return { used, remaining, ok: remaining > 0 };
}

// ── Doctor ───────────────────────────────────────────────────────────

function doctor(): Array<{
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  let db: Database;
  try {
    db = getDb();
    checks.push({
      name: "db-access",
      status: "ok",
      message: "Database accessible",
      fixable: false,
    });
  } catch (e: unknown) {
    checks.push({
      name: "db-access",
      status: "error",
      message: `Cannot open DB: ${e instanceof Error ? e.message : String(e)}`,
      fixable: false,
    });
    return checks;
  }

  // Cache health
  const cacheCount = (db.query("SELECT COUNT(*) as c FROM diagnostic_cache").get() as any).c;
  const expiredCount = (
    db
      .query("SELECT COUNT(*) as c FROM diagnostic_cache WHERE expires_at < ?")
      .get(Date.now()) as any
  ).c;
  checks.push({
    name: "cache",
    status: expiredCount > cacheCount * 0.5 ? "warn" : "ok",
    message: `${cacheCount} entries (${expiredCount} expired)`,
    fixable: expiredCount > 0,
  });

  // Stuck sessions
  const stuck = db
    .query("SELECT COUNT(*) as c FROM resource_sessions WHERE ended_at IS NULL AND started_at < ?")
    .get(Date.now() - DEFAULTS.wallClockMs * 2) as any;
  checks.push({
    name: "stuck-sessions",
    status: stuck.c > 0 ? "warn" : "ok",
    message: `${stuck.c} stuck session(s)`,
    fixable: stuck.c > 0,
  });

  // WAL size
  const walPath = DB_PATH + "-wal";
  if (existsSync(walPath)) {
    const walMB = Bun.file(walPath).size / 1024 / 1024;
    checks.push({
      name: "wal-size",
      status: walMB > 10 ? "warn" : "ok",
      message: `${walMB.toFixed(1)}MB WAL`,
      fixable: walMB > 10,
    });
  } else {
    checks.push({ name: "wal-size", status: "ok", message: "No WAL", fixable: false });
  }

  db.close();
  return checks;
}

// ── Fix ──────────────────────────────────────────────────────────────

function fixGovernor() {
  const db = getDb();

  // Clean expired cache
  const cacheResult = db.run("DELETE FROM diagnostic_cache WHERE expires_at < ?", [Date.now()]);
  const cacheDeleted = cacheResult.changes;

  // End stuck sessions
  const stuckResult = db.run(
    "UPDATE resource_sessions SET ended_at = ? WHERE ended_at IS NULL AND started_at < ?",
    [Date.now(), Date.now() - DEFAULTS.wallClockMs * 2]
  );
  const stuckFixed = stuckResult.changes;

  db.exec("VACUUM;");
  db.close();

  return { cacheDeleted, stuckFixed };
}

// ── Main CLI ─────────────────────────────────────────────────────────

async function main(): Promise<number> {
  await ensureDefaultsLoaded();
  const args = Bun.argv.slice(2);
  const command = args[0] || "status";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = await getProjectName(projectDir);

  printProjectBanner("Kimi Resource Governor v2.0");

  if (command === "limits") {
    logger.section("Current Resource Usage");
    const usage = getCurrentUsage();
    console.log(`  Memory:     ${usage.memoryMB}MB / ${DEFAULTS.maxMemoryMB}MB`);
    console.log(`  CPU time:   ${usage.cpuTimeMs}ms / ${DEFAULTS.maxCpuTimeMs}ms`);
    console.log(`  File size:  ${usage.fileSizeMB}MB / ${DEFAULTS.maxFileSizeMB}MB`);
    console.log(`  Open files: ${usage.openFiles} / ${DEFAULTS.maxOpenFiles}`);

    const violations = checkLimits(usage, {});
    if (violations.length > 0) {
      logger.warn("Violations:");
      for (const v of violations) console.log(`    ${v}`);
    } else {
      logger.info("Within limits");
    }
  } else if (command === "parallel") {
    logger.section("Parallelism Governor");
    console.log(`  Hardware concurrency: ${navigator.hardwareConcurrency || "unknown"}`);
    console.log(`  Max parallel jobs:    ${DEFAULTS.maxParallelJobs}`);

    const gov = new ParallelGovernor();
    console.log(`  Available slots:      ${gov.available}`);

    const tasks = [1, 2, 3, 4].map((i) =>
      gov.run(async () => {
        console.log(`    Task ${i} starting (slots: ${gov.available}, queued: ${gov.queued})...`);
        await Bun.sleep(500);
        console.log(`    Task ${i} done`);
        return i;
      })
    );

    await Promise.all(tasks);
    logger.info("All tasks completed");
  } else if (command === "quota") {
    logger.section(`Disk Quota: ${project}`);
    const { used, remaining, ok } = await checkDiskQuota(projectDir);
    console.log(`  Used:      ${used}MB`);
    console.log(`  Quota:     ${DEFAULTS.diskQuotaMB}MB`);
    console.log(`  Remaining: ${remaining}MB`);
    if (ok) logger.info("Within quota");
    else logger.error("Quota exceeded");
  } else if (command === "spawn") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      logger.error("Usage: spawn <command> [args...]");
      return 1;
    }
    logger.section("governedSpawn");
    const result = await governedSpawn(cmd, {
      onResourceWarning: (v: string[]) => logger.warn(v.join(", ")),
    });
    console.log(`  Exit code: ${result.exitCode}`);
    console.log(`  Killed:    ${result.killed}`);
    console.log(`  Memory:    ${result.usage.memoryMB}MB`);
    console.log(`  CPU:       ${result.usage.cpuTimeMs}ms`);
    console.log(`  Attempts:  ${result.attempts}`);
    if (result.stdout) {
      console.log("  stdout:");
      console.log(
        result.stdout
          .split("\n")
          .map((l: string) => `    ${l}`)
          .join("\n")
      );
    }
  } else if (command === "retry") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      logger.error("Usage: retry <command> [args...]");
      logger.info("Demonstrates retry with exponential backoff (max 3 attempts)");
      return 1;
    }
    logger.section("governedSpawn with retry");
    try {
      const result = await governedSpawn(cmd, {
        retry: { maxAttempts: 3, backoffMs: 500 },
        onResourceWarning: (v: string[]) => logger.warn(v.join(", ")),
      });
      console.log(`  Exit code: ${result.exitCode}`);
      console.log(`  Attempts:  ${result.attempts}`);
      console.log(`  Memory:    ${result.usage.memoryMB}MB`);
      if (result.stdout) {
        console.log("  stdout:");
        console.log(
          result.stdout
            .split("\n")
            .map((l: string) => `    ${l}`)
            .join("\n")
        );
      }
    } catch (err: any) {
      logger.error(`Failed after retries: ${err.message}`);
    }
  } else if (command === "cache") {
    const cmd = args.slice(1);
    if (cmd.length === 0) {
      logger.error("Usage: cache <command> [args...]");
      logger.info("Examples:");
      logger.info("  cache bun --version");
      logger.info("  cache --force bun --version  (bypass cache)");
      return 1;
    }

    const force = cmd[0] === "--force";
    const actualCmd = force ? cmd.slice(1) : cmd;

    logger.section("Diagnostic Cache");
    const output = await cachedExec(actualCmd, { force, logger });
    console.log("  Output:");
    console.log(
      output
        .split("\n")
        .map((l: string) => `    ${l}`)
        .join("\n")
    );
  } else if (command === "doctor") {
    const checks = doctor();
    const report = buildDoctorReport("kimi-resource-governor", checks);
    logger.section(`${report.tool} Doctor`);
    for (const check of report.checks) {
      logger.check(check);
    }
    logger.info(
      `${report.errorCount} error(s), ${report.warnCount} warning(s), ${report.fixableCount} fixable`
    );
    if (report.fixableCount > 0) {
      logger.info("Run 'kimi-resource-governor fix' to repair");
    }
    return report.errorCount > 0 ? 1 : 0;
  } else if (command === "fix") {
    logger.section("Fixing Resource Governor");
    ensureDir(GOVERNOR_DIR);
    const configPath = getGovernorConfigPath();
    if (!existsSync(configPath)) {
      await Bun.write(configPath, DEFAULT_CONFIG_TEMPLATE);
      logger.info(`Wrote default config: ${configPath}`);
      await ensureDefaultsLoaded();
    }
    const result = fixGovernor();
    logger.info(`Cleaned ${result.cacheDeleted} expired cache entries`);
    logger.info(`Ended ${result.stuckFixed} stuck sessions`);
    logger.info("Database vacuumed");
  } else if (command === "session") {
    logger.section("Session Management");
    const id = getSessionId();
    console.log(`  Session ID: ${id}`);

    const db = getDb();
    const active = db
      .query("SELECT COUNT(*) as c FROM resource_sessions WHERE ended_at IS NULL")
      .get() as any;
    const total = db.query("SELECT COUNT(*) as c FROM resource_sessions").get() as any;
    db.close();

    console.log(`  Active sessions: ${active.c}`);
    console.log(`  Total sessions:  ${total.c}`);

    startSession(project);
    logger.info(`Session started for ${project}`);
  } else if (command === "cleanup") {
    logger.section("Cache Cleanup");
    const deleted = cleanupCache();
    logger.info(`Removed ${deleted} expired cache entries`);
  } else if (command === "status") {
    logger.section("Defaults");
    console.log(`  Config file:       ${getGovernorConfigPath()}`);
    console.log(`  Max memory:        ${DEFAULTS.maxMemoryMB}MB`);
    console.log(`  Max CPU time:      ${DEFAULTS.maxCpuTimeMs}ms`);
    console.log(`  Max file size:     ${DEFAULTS.maxFileSizeMB}MB`);
    console.log(`  Max open files:    ${DEFAULTS.maxOpenFiles}`);
    console.log(`  Max parallel:      ${DEFAULTS.maxParallelJobs}`);
    console.log(`  Disk quota:        ${DEFAULTS.diskQuotaMB}MB`);
    console.log(`  Cache TTL:         ${DEFAULTS.cacheTTLSeconds}s`);
    console.log(`  Wall-clock limit:  ${DEFAULTS.wallClockMs}ms`);
    logger.section("Commands");
    console.log("  limits          Show current resource usage");
    console.log("  parallel        Test parallelism governor");
    console.log("  quota           Check disk quota");
    console.log("  spawn <cmd>     Run command with governedSpawn (tree-kill, ps memory)");
    console.log("  retry <cmd>     Run command with retry + exponential backoff");
    console.log("  cache <cmd>     Cached command execution");
    console.log("  doctor          Check governor health");
    console.log("  fix             Clean cache, end stuck sessions, vacuum");
    console.log("  session         Start/manage sessions");
    console.log("  cleanup         Remove expired cache entries");
    console.log("");
    console.log("Import in your code:");
    console.log(
      "  import { governedSpawn, ParallelGovernor, cachedExec, cachedDoctor } from './kimi-resource-governor.ts'"
    );
    console.log("");
    console.log("New spawn options:");
    console.log("  killTree: false       — disable process tree cleanup");
    console.log("  retry: { maxAttempts, backoffMs } — exponential backoff retry");
  }

  return 0;
}

function printProjectBanner(title: string) {
  logger.banner(title);
}

// Auto-end session on graceful exit
async function gracefulShutdown(_signal: string) {
  if (hasSessionId()) {
    endSession(getSessionId());
  }
  await Bun.sleep(50);
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
process.on("beforeExit", () => {
  if (hasSessionId()) endSession(getSessionId());
});

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      new CliError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }),
  { toolName: "kimi-resource-governor" }
);
process.exit(exitCode);
