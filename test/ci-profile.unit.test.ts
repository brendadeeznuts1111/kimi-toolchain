import { describe, expect, test } from "bun:test";
import { join } from "path";
import { findCpuProfile } from "../src/lib/ci-profile.ts";
import { captureProfile, PERF_GATE_SLOW_MS } from "../src/lib/perf-gate.ts";
import { REPO_ROOT, testTempDir, cleanupPath } from "./helpers.ts";

describe("ci-profile", () => {
  test("findCpuProfile returns newest cpuprofile in directory", async () => {
    const dir = testTempDir("ci-profile-");
    try {
      expect(findCpuProfile(dir)).toBeNull();
      await Bun.write(join(dir, "a.cpuprofile"), "{}");
      await Bun.sleep(5);
      await Bun.write(join(dir, "b.cpuprofile"), "{}");
      expect(findCpuProfile(dir)?.endsWith("b.cpuprofile")).toBe(true);
    } finally {
      cleanupPath(dir);
    }
  });

  test("captureProfile marks slow runs above threshold", async () => {
    const fast = await captureProfile("fast", () => 1, PERF_GATE_SLOW_MS);
    expect(fast.slow).toBe(false);

    const slow = await captureProfile(
      "slow",
      async () => {
        await Bun.sleep(20);
        return 2;
      },
      1
    );
    expect(slow.slow).toBe(true);
    expect(slow.result).toBe(2);
  });

  test("verify script passes in repo root", async () => {
    const proc = Bun.spawn(["bun", "scripts/verify-bun-features.ts"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  }, 60_000);
});
