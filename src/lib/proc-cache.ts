/**
 * proc-cache.ts — Shared TTL cache for process/system queries.
 *
 * Single source of truth for ps caching, orphan detection, and process
 * lookup helpers. Previously duplicated between memory-budget.ts and
 * process-utils.ts.
 */

import { dedupInflight, hashInflightPayload, readableStreamToText } from "./bun-utils.ts";
const inflightCommands = new Map<string, Promise<string>>();
const decoder = new TextDecoder();

// ── Cache ────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const _procCache = new Map<string, CacheEntry<string>>();
const CACHE_TTL_MS = 1000;
/** Shorter threshold for install/typecheck storms. */
const ORPHAN_FAST_MIN_AGE_SECONDS = 45;
const ORPHAN_REPARENTED_MIN_AGE_SECONDS = 30;

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
    const output = await readableStreamToText(proc.stdout);
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

/** Matches bun test invocations: bare, flag-wrapped, absolute, ephemeral bun-node paths. */
const BUN_TEST_CMD_RE = /(^|[\s/])bun( --[\w-]+)* test\b/;
/** Matches gate entry points: bun run test|test:fast|check[:fast], scripts/(check|test-fast).ts. */
const BUN_GATE_CMD_RE =
  /(^|[\s/])bun( --[\w-]+)* run (test|test:fast|check(:fast)?)\b|scripts\/(check|test-fast)\.ts\b/;

export function isOrphanCandidateCommand(cmd: string): boolean {
  if (
    cmd.includes("kimi-orphan-kill") ||
    cmd.includes("kimi-toolchain.ts orphan-kill") ||
    cmd.includes("kimi-toolchain orphan-kill")
  ) {
    return false;
  }

  return (
    BUN_TEST_CMD_RE.test(cmd) ||
    BUN_GATE_CMD_RE.test(cmd) ||
    /\bbun install\b/.test(cmd) ||
    /\btsc --noEmit\b/.test(cmd) ||
    /\bnode\b.*\btsc\b/.test(cmd) ||
    (cmd.includes("bun run") && /\bkimi-[\w-]+/.test(cmd)) ||
    cmd.includes("/.kimi-code/bin/kimi --version") ||
    (cmd.includes("/bin/cp") && cmd.includes("kimi-test"))
  );
}

function isFastOrphanCommand(cmd: string): boolean {
  return (
    /\bbun install\b/.test(cmd) || /\btsc --noEmit\b/.test(cmd) || /\bnode\b.*\btsc\b/.test(cmd)
  );
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * An orphan is a candidate command whose PARENT IS DEAD (reparented to
 * launchd, or ppid no longer alive). Processes with a live parent are never
 * orphans — a long-running suite is owned by its live parent gate, and the
 * gate's own watchdog is responsible for it.
 */
export function collectOrphanCandidates(
  psOutput: string,
  options: { pidAlive?: (pid: number) => boolean } = {}
): OrphanProcessInfo[] {
  const pidAlive = options.pidAlive ?? defaultPidAlive;
  const orphans: OrphanProcessInfo[] = [];

  for (const line of psOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1] || "", 10);
    const ppid = parseInt(match[2] || "", 10);
    const cpu = parseFloat(match[3] || "");
    const elapsedSeconds = parseInt(match[4] || "", 10);
    const cmd = match[5] || "";

    if (
      isNaN(pid) ||
      isNaN(ppid) ||
      isNaN(cpu) ||
      isNaN(elapsedSeconds) ||
      pid === process.pid ||
      pid === process.ppid ||
      !isOrphanCandidateCommand(cmd)
    ) {
      continue;
    }

    const parentDead = ppid === 1 || !pidAlive(ppid);
    if (!parentDead) continue;

    const minAge = isFastOrphanCommand(cmd)
      ? ORPHAN_FAST_MIN_AGE_SECONDS
      : ORPHAN_REPARENTED_MIN_AGE_SECONDS;
    if (elapsedSeconds < minAge) continue;

    orphans.push({ pid, cmd, cpu, elapsedSeconds });
  }

  return orphans;
}

export function getOrphanCandidates(): OrphanProcessInfo[] {
  const output = getCachedPs(["-axo", "pid=,ppid=,pcpu=,etimes=,command="]);
  return collectOrphanCandidates(output);
}

/**
 * Count candidate orphan processes (stale bun test / kimi tool runners)
 * without parsing per-process details.
 */
export function countOrphanCandidates(): number {
  return getOrphanCandidates().length;
}
