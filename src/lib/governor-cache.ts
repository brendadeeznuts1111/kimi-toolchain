/**
 * Diagnostic cache: cachedExec and cachedDoctor
 */

import { DEFAULTS } from "./governor-state.ts";
import { governedSpawn } from "./governor-spawn.ts";
import { getCached, setCached, hashCommand } from "./governor-sessions.ts";

export async function cachedExec(
  command: string[],
  options?: { cwd?: string; ttl?: number; force?: boolean }
): Promise<string> {
  const cwd = options?.cwd || Bun.cwd;
  const key = hashCommand(command[0], command.slice(1), cwd);

  if (!options?.force) {
    const cached = getCached(key);
    if (cached) {
      console.log(`  💾 Cache hit: ${command.join(" ")}`);
      return cached.output;
    }
  }

  console.log(`  🔄 Cache miss: ${command.join(" ")}`);
  const result = await governedSpawn(command, { cwd });
  const output = result.stdout || result.stderr;

  setCached(key, command.join(" "), output, options?.ttl);
  return output;
}

export async function cachedDoctor(
  checkName: string,
  fn: () => Promise<string>,
  ttlSeconds = DEFAULTS.cacheTTLSeconds
): Promise<string> {
  const key = hashCommand("kimi-doctor", [checkName], Bun.cwd);

  const cached = getCached(key);
  if (cached) {
    const ageSeconds = Math.round((Date.now() - cached.createdAt) / 1000);
    console.log(`  💾 Doctor cache hit: ${checkName} (${ageSeconds}s old)`);
    return cached.output;
  }

  console.log(`  🔄 Doctor cache miss: ${checkName}`);
  const output = await fn();
  setCached(key, `kimi-doctor:${checkName}`, output, ttlSeconds);
  return output;
}
