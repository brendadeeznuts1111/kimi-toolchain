#!/usr/bin/env bun
import { pathExists } from "../lib/bun-io.ts";
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
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot } from "../lib/utils.ts";

import { Duration, Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  getGovernorConfigPath,
  DEFAULT_CONFIG_TEMPLATE,
  bunAvailableParallelism,
  resolveHardwareParallelism,
} from "../lib/governor-config.ts";
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
  if (pathExists(walPath)) {
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

  logger.projectBanner("Kimi Resource Governor v2.0");

  if (command === "limits") {
    logger.section("Current Resource Usage");
    const usage = getCurrentUsage();
    logger.line(`  Memory:     ${usage.memoryMB}MB / ${DEFAULTS.maxMemoryMB}MB`);
    logger.line(`  CPU time:   ${usage.cpuTimeMs}ms / ${DEFAULTS.maxCpuTimeMs}ms`);
    logger.line(`  File size:  ${usage.fileSizeMB}MB / ${DEFAULTS.maxFileSizeMB}MB`);
    logger.line(`  Open files: ${usage.openFiles} / ${DEFAULTS.maxOpenFiles}`);

    const violations = checkLimits(usage, {});
    if (violations.length > 0) {
      logger.warn("Violations:");
      for (const v of violations) logger.line(`    ${v}`);
    } else {
      logger.info("Within limits");
    }
  } else if (command === "parallel") {
    logger.section("Parallelism Governor");
    logger.line(`  Hardware concurrency: ${navigator.hardwareConcurrency || "unknown"}`);
    logger.line(`  Max parallel jobs:    ${DEFAULTS.maxParallelJobs}`);

    const gov = new ParallelGovernor();
    logger.line(`  Available slots:      ${gov.available}`);

    const tasks = [1, 2, 3, 4].map((i) =>
      gov.run(() =>
        Effect.gen(function* () {
          logger.line(`    Task ${i} starting (slots: ${gov.available}, queued: ${gov.queued})...`);
          yield* Effect.sleep(Duration.millis(500));
          logger.line(`    Task ${i} done`);
          return i;
        })
      )
    );

    await Effect.runPromise(Effect.all(tasks));
    logger.info("All tasks completed");
  } else if (command === "quota") {
    logger.section(`Disk Quota: ${project}`);
    const { used, remaining, ok } = await checkDiskQuota(projectDir);
    logger.line(`  Used:      ${used}MB`);
    logger.line(`  Quota:     ${DEFAULTS.diskQuotaMB}MB`);
    logger.line(`  Remaining: ${remaining}MB`);
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
    logger.line(`  Exit code: ${result.exitCode}`);
    logger.line(`  Killed:    ${result.killed}`);
    logger.line(`  Memory:    ${result.usage.memoryMB}MB`);
    logger.line(`  CPU:       ${result.usage.cpuTimeMs}ms`);
    logger.line(`  Attempts:  ${result.attempts}`);
    if (result.stdout) {
      logger.line("  stdout:");
      logger.line(
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
      logger.line(`  Exit code: ${result.exitCode}`);
      logger.line(`  Attempts:  ${result.attempts}`);
      logger.line(`  Memory:    ${result.usage.memoryMB}MB`);
      if (result.stdout) {
        logger.line("  stdout:");
        logger.line(
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
    logger.line("  Output:");
    logger.line(
      output
        .split("\n")
        .map((l: string) => `    ${l}`)
        .join("\n")
    );
  } else if (command === "doctor") {
    const checks = doctor();
    return logger.runDoctor("kimi-resource-governor", checks);
  } else if (command === "fix") {
    logger.section("Fixing Resource Governor");
    ensureDir(GOVERNOR_DIR);
    const configPath = getGovernorConfigPath();
    if (!pathExists(configPath)) {
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
    logger.line(`  Session ID: ${id}`);

    const db = getDb();
    const active = db
      .query("SELECT COUNT(*) as c FROM resource_sessions WHERE ended_at IS NULL")
      .get() as any;
    const total = db.query("SELECT COUNT(*) as c FROM resource_sessions").get() as any;
    db.close();

    logger.line(`  Active sessions: ${active.c}`);
    logger.line(`  Total sessions:  ${total.c}`);

    startSession(project);
    logger.info(`Session started for ${project}`);
  } else if (command === "cleanup") {
    logger.section("Cache Cleanup");
    const deleted = cleanupCache();
    logger.info(`Removed ${deleted} expired cache entries`);
  } else if (command === "status") {
    logger.section("Defaults");
    logger.line(`  Config file:       ${getGovernorConfigPath()}`);
    const availableParallelism = bunAvailableParallelism();
    logger.line(
      `  Available parallelism: ${availableParallelism ?? "n/a"} (cgroup-aware, Bun 1.4+)`
    );
    logger.line(`  Hardware concurrency:  ${navigator.hardwareConcurrency ?? "unknown"}`);
    logger.line(`  Resolved parallelism:  ${resolveHardwareParallelism()}`);
    logger.line(`  Max memory:        ${DEFAULTS.maxMemoryMB}MB`);
    logger.line(`  Max CPU time:      ${DEFAULTS.maxCpuTimeMs}ms`);
    logger.line(`  Max file size:     ${DEFAULTS.maxFileSizeMB}MB`);
    logger.line(`  Max open files:    ${DEFAULTS.maxOpenFiles}`);
    logger.line(`  Max parallel:      ${DEFAULTS.maxParallelJobs}`);
    logger.line(`  Disk quota:        ${DEFAULTS.diskQuotaMB}MB`);
    logger.line(`  Cache TTL:         ${DEFAULTS.cacheTTLSeconds}s`);
    logger.line(`  Wall-clock limit:  ${DEFAULTS.wallClockMs}ms`);
    logger.section("Commands");
    logger.line("  limits          Show current resource usage");
    logger.line("  parallel        Test parallelism governor");
    logger.line("  quota           Check disk quota");
    logger.line("  spawn <cmd>     Run command with governedSpawn (tree-kill, ps memory)");
    logger.line("  retry <cmd>     Run command with retry + exponential backoff");
    logger.line("  cache <cmd>     Cached command execution");
    logger.line("  doctor          Check governor health");
    logger.line("  fix             Clean cache, end stuck sessions, vacuum");
    logger.line("  session         Start/manage sessions");
    logger.line("  cleanup         Remove expired cache entries");
    logger.line("");
    logger.line("Import in your code:");
    logger.line(
      "  import { governedSpawn, ParallelGovernor, cachedExec, cachedDoctor } from './kimi-resource-governor.ts'"
    );
    logger.line("");
    logger.line("New spawn options:");
    logger.line("  killTree: false       — disable process tree cleanup");
    logger.line("  retry: { maxAttempts, backoffMs } — exponential backoff retry");
  }

  return 0;
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
  { toolName: "kimi-resource-governor", logger }
);
process.exit(exitCode);
