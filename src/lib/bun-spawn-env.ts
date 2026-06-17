/**
 * bun-spawn-env.ts — Bun spawn/run environment helpers (v1.3.14+ no-orphans).
 *
 * @see https://bun.sh/docs/runtime/bunfig#run-noorphans-don-t-leave-orphan-processes-behind
 */

/** Merge `BUN_FEATURE_FLAG_NO_ORPHANS=1` into a spawn env (macOS/Linux). */
export function withNoOrphansEnv(
  base: Record<string, string | undefined> = Bun.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value != null) env[key] = value;
  }
  if (process.platform !== "win32") {
    env.BUN_FEATURE_FLAG_NO_ORPHANS = "1";
  }
  return env;
}
