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

  // ── Signal handling regression tests ──────────────────────────────────
  // These cover the bugs fixed in the kill-logic rewrite:
  //   1. TOCTOU race: a clean exit must NOT be reported as killed.
  //   2. Dead ternary: the reported signal must reflect the actual signal used.
  //   3. Descendant survivor leak: SIGKILL fallback must reap lingering children.
  //   4. killFallbackId lifecycle: cleanup must not no-op the fallback timer.

  test(
    "clean exit before timeout is NOT reported as killed",
    async () => {
      if (process.platform === "win32") return;
      // Exit immediately; timeout is generous so the timer never fires.
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
      // Sleep longer than the timeout; sh handles SIGTERM by default.
      const result = await governedSpawn(["sh", "-c", "sleep 30"], {
        timeoutMs: 300,
        limits: RELAXED_LIMITS,
      });

      expect(result.killed).toBe(true);
      expect(result.signal).toBe("SIGTERM");
    },
    { timeout: 10000 }
  );

  test(
    "SIGKILL escalation reported when process ignores SIGTERM",
    async () => {
      if (process.platform === "win32") return;
      // Trap SIGTERM and refuse to die; the 5s fallback must SIGKILL.
      // `trap '' TERM` makes sh ignore SIGTERM. Use a subshell that lingers.
      const result = await governedSpawn(["sh", "-c", "trap '' TERM; sleep 30"], {
        timeoutMs: 300,
        limits: RELAXED_LIMITS,
      });

      expect(result.killed).toBe(true);
      // SIGTERM was sent first, but the process survived, so the fallback
      // escalated to SIGKILL — the reported signal must reflect that.
      expect(result.signal).toBe("SIGKILL");
    },
    { timeout: 15000 }
  );

  test(
    "descendant that survives root SIGTERM is reaped by fallback",
    async () => {
      if (process.platform === "win32") return;
      // Parent sh traps SIGTERM and spawns a child that also traps SIGTERM.
      // The root will be SIGKILLed by the fallback; the child must also be
      // reaped (not leaked). We verify via exit — if the child leaked, the
      // test harness would hang on the fallback timer or leave orphans.
      const result = await governedSpawn(["sh", "-c", "trap '' TERM; sleep 30 & wait"], {
        timeoutMs: 300,
        limits: RELAXED_LIMITS,
      });

      expect(result.killed).toBe(true);
      expect(result.signal).toBe("SIGKILL");
    },
    { timeout: 15000 }
  );
});
