/**
 * Diagnostic cache: cachedExec and cachedDoctor
 */
// .tochange:governor-cache-dedup — dedup concurrent calls; peekPromise when promise already fulfilled

import { DEFAULTS } from "./governor-state.ts";
import { governedSpawn } from "./governor-spawn.ts";
import { getCached, setCached, hashCommand } from "./governor-sessions.ts";
import { createLogger, type Logger } from "./logger.ts";

function resolveLogger(logger?: Logger): Logger {
  return logger ?? createLogger(Bun.argv, "resource-governor");
}

export async function cachedExec(
  command: string[],
  options?: { cwd?: string; ttl?: number; force?: boolean; logger?: Logger }
): Promise<string> {
  const log = resolveLogger(options?.logger);
  const cwd = options?.cwd || Bun.cwd;
  const key = hashCommand(command[0], command.slice(1), cwd);

  if (!options?.force) {
    const cached = getCached(key);
    if (cached) {
      log.line(`  💾 Cache hit: ${command.join(" ")}`);
      return cached.output;
    }
  }

  log.line(`  🔄 Cache miss: ${command.join(" ")}`);
  const result = await governedSpawn(command, { cwd });
  const output = result.stdout || result.stderr;

  setCached(key, command.join(" "), output, options?.ttl);
  return output;
}

export async function cachedDoctor(
  checkName: string,
  fn: () => Promise<string>,
  ttlSeconds = DEFAULTS.cacheTTLSeconds,
  logger?: Logger
): Promise<string> {
  const log = resolveLogger(logger);
  const key = hashCommand("kimi-doctor", [checkName], Bun.cwd);

  const cached = getCached(key);
  if (cached) {
    const ageSeconds = Math.round((Date.now() - cached.createdAt) / 1000);
    log.line(`  💾 Doctor cache hit: ${checkName} (${ageSeconds}s old)`);
    return cached.output;
  }

  log.line(`  🔄 Doctor cache miss: ${checkName}`);
  const output = await fn();
  setCached(key, `kimi-doctor:${checkName}`, output, ttlSeconds);
  return output;
}
