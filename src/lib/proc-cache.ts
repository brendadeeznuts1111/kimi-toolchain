/**
 * proc-cache.ts — Shared TTL cache for process/system queries.
 *
 * Single source of truth for ps caching, orphan detection, and process
 * lookup helpers. Previously duplicated between memory-budget.ts and
 * process-utils.ts.
 */

const decoder = new TextDecoder();

// ── Cache ────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const _procCache = new Map<string, CacheEntry<string>>();
const CACHE_TTL_MS = 1000;

/** Run a ps command with TTL caching — avoids repeated subprocess calls. */
export function getCachedPs(args: string[]): string {
  const key = args.join(" ");
  const now = Date.now();
  const entry = _procCache.get(key);
  if (entry && now - entry.ts < CACHE_TTL_MS) return entry.value;

  try {
    const output = decoder.decode(Bun.spawnSync(["ps", ...args]).stdout);
    _procCache.set(key, { value: output, ts: now });
    return output;
  } catch {
    return "";
  }
}

/** Clear the process cache (useful between test runs or after state changes). */
export function clearProcessCache(): void {
  _procCache.clear();
}

// ── Orphan detection ─────────────────────────────────────────────────

/**
 * Count candidate orphan processes (stale bun test / kimi tool runners)
 * without parsing per-process details.
 */
export function countOrphanCandidates(): number {
  const output = getCachedPs(["aux"]);
  let count = 0;
  for (const line of output.split("\n")) {
    if (
      line.includes("/.bun/bin/bun test") ||
      (line.includes("bun run") && line.includes("kimi-")) ||
      line.includes("/.kimi-code/bin/kimi --version") ||
      (line.includes("/bin/cp") && line.includes("kimi-test"))
    ) {
      count++;
    }
  }
  return count;
}
