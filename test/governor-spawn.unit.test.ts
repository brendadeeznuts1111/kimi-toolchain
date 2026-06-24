import { describe, expect, test } from "bun:test";
import { governedSpawn } from "../src/lib/governor-spawn.ts";

/** Pre-check uses performance.now() as cpuTimeMs — relax limits for late-suite runs. */
const RELAXED_LIMITS = { maxCpuTimeMs: Number.MAX_SAFE_INTEGER, maxMemoryMB: 16_384 };

describe("governor-spawn", () => {
  test(
    "governedSpawn passes BUN_FEATURE_FLAG_NO_ORPHANS=1 on non-win32",
    async () => {
      if (process.platform === "win32") return;

      const result = await governedSpawn(
        ["bun", "-e", 'console.log(process.env.BUN_FEATURE_FLAG_NO_ORPHANS ?? "missing")'],
        { timeoutMs: 3000, limits: RELAXED_LIMITS }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("1");
    },
    { timeout: 5000 }
  );

  test(
    "governedSpawn caller env overrides no-orphans base",
    async () => {
      if (process.platform === "win32") return;

      // Use sh so we observe the spawn env merge (bun child may re-set the flag).
      const result = await governedSpawn(
        ["sh", "-c", 'echo "${BUN_FEATURE_FLAG_NO_ORPHANS:-missing}"'],
        {
          timeoutMs: 3000,
          limits: RELAXED_LIMITS,
          env: { BUN_FEATURE_FLAG_NO_ORPHANS: "0" },
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("0");
    },
    { timeout: 5000 }
  );

  test(
    "clean exit before timeout is NOT reported as killed",
    async () => {
      if (process.platform === "win32") return;
      const result = await governedSpawn(["sh", "-c", "exit 0"], {
        timeoutMs: 5000,
        limits: RELAXED_LIMITS,
      });

      expect(result.exitCode).toBe(0);
      expect(result.killed).toBe(false);
      expect(result.signal).toBeUndefined();
    },
    { timeout: 8000 }
  );

  test(
    "timeout reports SIGTERM and killed=true",
    async () => {
      if (process.platform === "win32") return;
      const result = await governedSpawn(["sh", "-c", "sleep 30"], {
        timeoutMs: 300,
        limits: RELAXED_LIMITS,
      });

      expect(result.killed).toBe(true);
      expect(result.signal).toBe("SIGTERM");
    },
    { timeout: 10000 }
  );
});
