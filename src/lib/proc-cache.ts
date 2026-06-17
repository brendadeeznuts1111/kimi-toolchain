/**
 * proc-cache.ts — Shared TTL cache for process/system queries.
 *
 * Single source of truth for ps/pgrep caching, orphan detection, and process
 * lookup helpers. Previously duplicated between memory-budget.ts,
 * process-utils.ts, and governor-spawn.ts.
 */

import { dedupInflight, peekPromise, peekPromiseStatus } from "./bun-utils.ts";

const decoder = new TextDecoder();

// ── Cache ────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const _execCache = new Map<string, CacheEntry<string>>();
const _inflightExec = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 1000;
const ORPHAN_MIN_AGE_SECONDS = 120;

function execCacheKey(cmd: string, args: string[]): string {
  return `${cmd}\0${args.join("\0")}`;
}

function cacheHit(key: string, now = Date.now()): string | null {
  const entry = _execCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;
  return null;
}

function storeOutput(key: string, output: string): string {
  _execCache.set(key, { value: output, ts: Date.now() });
  return output;
}

function readExecStdoutSync(cmd: string, args: string[]): string {
  try {
    const proc = Bun.spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
    return decoder.decode(proc.stdout);
  } catch {
    return "";
  }
}

function runExecFetch(cmd: string, args: string[]): Promise<string> {
  const key = execCacheKey(cmd, args);
  return dedupInflight(_inflightExec, key, async () =>
    storeOutput(key, readExecStdoutSync(cmd, args))
  );
}

/** Run a short diagnostic command with TTL caching and in-flight dedup. */
export function getCachedCommandOutput(cmd: string, args: string[]): string {
  const key = execCacheKey(cmd, args);
  const hit = cacheHit(key);
  if (hit !== null) return hit;

  const inflight = _inflightExec.get(key);
  if (inflight && peekPromiseStatus(inflight) === "fulfilled") {
    try {
      return peekPromise(inflight) as string;
    } catch {
      /* spawn below */
    }
  }

  return storeOutput(key, readExecStdoutSync(cmd, args));
}

/** Async variant — preferred for concurrent doctor / governor paths. */
export async function getCachedCommandOutputAsync(cmd: string, args: string[]): Promise<string> {
  const key = execCacheKey(cmd, args);
  const hit = cacheHit(key);
  if (hit !== null) return hit;
  return runExecFetch(cmd, args);
}

/** Run `ps` with TTL caching — alias over getCachedCommandOutput. */
export function getCachedPs(args: string[]): string {
  return getCachedCommandOutput("ps", args);
}

/** Async `ps` cache with in-flight dedup. */
export async function getCachedPsAsync(args: string[]): Promise<string> {
  return getCachedCommandOutputAsync("ps", args);
}

/** Clear exec/ps caches (tests and between doctor runs). */
export function clearProcessCache(): void {
  _execCache.clear();
  _inflightExec.clear();
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
