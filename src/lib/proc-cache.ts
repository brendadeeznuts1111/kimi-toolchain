/**
 * proc-cache.ts — Shared TTL cache for process/system queries.
 *
 * Single source of truth for ps caching, orphan detection, and process
 * lookup helpers. Previously duplicated between memory-budget.ts and
 * process-utils.ts.
 */

import { dedupInflight, peekPromise, peekPromiseStatus } from "./bun-utils.ts";

const decoder = new TextDecoder();

// ── Cache ────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const _procCache = new Map<string, CacheEntry<string>>();
const _inflightPs = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 1000;
const ORPHAN_MIN_AGE_SECONDS = 120;

function psCacheHit(key: string, now = Date.now()): string | null {
  const entry = _procCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;
  return null;
}

function runPsFetch(args: string[]): Promise<string> {
  const key = args.join(" ");
  return dedupInflight(_inflightPs, key, async () => {
    try {
      const output = decoder.decode(Bun.spawnSync(["ps", ...args]).stdout);
      _procCache.set(key, { value: output, ts: Date.now() });
      return output;
    } catch {
      return "";
    }
  });
}

// .implemented:proc-cache-async — async TTL + in-flight dedup; sync path peeks fulfilled inflight
/** Run a ps command with TTL caching — avoids repeated subprocess calls. */
export function getCachedPs(args: string[]): string {
  const key = args.join(" ");
  const hit = psCacheHit(key);
  if (hit !== null) return hit;

  const inflight = _inflightPs.get(key);
  if (inflight && peekPromiseStatus(inflight) === "fulfilled") {
    try {
      return peekPromise(inflight) as string;
    } catch {
      /* spawn below */
    }
  }

  try {
    const output = decoder.decode(Bun.spawnSync(["ps", ...args]).stdout);
    _procCache.set(key, { value: output, ts: Date.now() });
    return output;
  } catch {
    return "";
  }
}

/** Async ps cache with in-flight dedup (preferred for concurrent doctor paths). */
export async function getCachedPsAsync(args: string[]): Promise<string> {
  const key = args.join(" ");
  const hit = psCacheHit(key);
  if (hit !== null) return hit;
  return runPsFetch(args);
}

/** Clear the process cache (useful between test runs or after state changes). */
export function clearProcessCache(): void {
  _procCache.clear();
  _inflightPs.clear();
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
