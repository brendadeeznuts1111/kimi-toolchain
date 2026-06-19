/**
 * proc-cache.ts — Shared TTL cache for process/system queries.
 *
 * Single source of truth for ps caching, orphan detection, and process
 * lookup helpers. Previously duplicated between memory-budget.ts and
 * process-utils.ts.
 */

import { dedupInflight, hashInflightPayload } from "./bun-utils.ts";

const decoder = new TextDecoder();
const inflightCommands = new Map<string, Promise<string>>();

// ── Cache ────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const _procCache = new Map<string, CacheEntry<string>>();
const CACHE_TTL_MS = 1000;
const ORPHAN_MIN_AGE_SECONDS = 120;

function commandCacheKey(command: string, args: readonly string[]): string {
  return hashInflightPayload({ command, args });
}

/** Run a command with TTL caching — avoids repeated subprocess calls. */
export function getCachedCommandOutput(command: string, args: readonly string[] = []): string {
  const key = commandCacheKey(command, args);
  const now = Date.now();
  const entry = _procCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;

  try {
    const output = decoder.decode(Bun.spawnSync([command, ...args]).stdout);
    _procCache.set(key, { value: output, ts: now });
    return output;
  } catch {
    return "";
  }
}

/** Async command cache with in-flight dedup for concurrent callers. */
export async function getCachedCommandOutputAsync(
  command: string,
  args?: readonly string[]
): Promise<string> {
  const resolved = args ?? [];
  const key = commandCacheKey(command, resolved);
  const now = Date.now();
  const entry = _procCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;

  return dedupInflight(inflightCommands, key, async () => {
    const proc = Bun.spawn([command, ...resolved], { stdout: "pipe", stderr: "pipe" });
    const output = decoder.decode(await new Response(proc.stdout).arrayBuffer());
    await proc.exited;
    _procCache.set(key, { value: output, ts: Date.now() });
    return output;
  });
}

/** Run a ps command with TTL caching — avoids repeated subprocess calls. */
export function getCachedPs(args: string[]): string {
  return getCachedCommandOutput("ps", args);
}

/** Async ps cache — delegates to getCachedCommandOutputAsync. */
export async function getCachedPsAsync(args: readonly string[]): Promise<string> {
  return getCachedCommandOutputAsync("ps", args);
}

/** Clear the process cache (useful between test runs or after state changes). */
export function clearProcessCache(): void {
  _procCache.clear();
  inflightCommands.clear();
}

// ── Orphan detection ─────────────────────────────────────────────────

export interface OrphanProcessInfo {
  pid: number;
  cmd: string;
  cpu: number;
  elapsedSeconds: number;
}

function isOrphanCandidateCommand(cmd: string): boolean {
  if (
    cmd.includes("kimi-orphan-kill") ||
    cmd.includes("kimi-toolchain.ts orphan-kill") ||
    cmd.includes("kimi-toolchain orphan-kill")
  ) {
    return false;
  }

  return (
    cmd.includes("/.bun/bin/bun test") ||
    (cmd.includes("bun run") && /\bkimi-[\w-]+/.test(cmd)) ||
    cmd.includes("/.kimi-code/bin/kimi --version") ||
    (cmd.includes("/bin/cp") && cmd.includes("kimi-test"))
  );
}

export function getOrphanCandidates(): OrphanProcessInfo[] {
  const output = getCachedPs(["-axo", "pid=,pcpu=,etimes=,command="]);
  const orphans: OrphanProcessInfo[] = [];

  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1] || "", 10);
    const cpu = parseFloat(match[2] || "");
    const elapsedSeconds = parseInt(match[3] || "", 10);
    const cmd = match[4] || "";

    if (
      isNaN(pid) ||
      isNaN(cpu) ||
      isNaN(elapsedSeconds) ||
      pid === process.pid ||
      pid === process.ppid ||
      elapsedSeconds < ORPHAN_MIN_AGE_SECONDS ||
      !isOrphanCandidateCommand(cmd)
    ) {
      continue;
    }

    orphans.push({ pid, cmd, cpu, elapsedSeconds });
  }

  return orphans;
}

/**
 * Count candidate orphan processes (stale bun test / kimi tool runners)
 * without parsing per-process details.
 */
export function countOrphanCandidates(): number {
  return getOrphanCandidates().length;
}
