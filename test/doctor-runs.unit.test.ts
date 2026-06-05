import { describe, expect, test } from "bun:test";
import { join } from "path";
import { getPersistentWarnings, recordDoctorRun } from "../src/lib/doctor-runs.ts";

const TEST_HOME = join(import.meta.dir, ".tmp-doctor-runs-home");

describe("doctor-runs", () => {
  test("recordDoctorRun and getPersistentWarnings round-trip", () => {
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = TEST_HOME;

    try {
      recordDoctorRun("test-project", "kimi-test-tool", [
        { check: "unit-test-warning", message: "synthetic", severity: "warn" },
      ]);

      const warnings = getPersistentWarnings("kimi-test-tool");
      expect(warnings.some((w) => w.check_name === "unit-test-warning")).toBe(true);
    } finally {
      Bun.env.HOME = prevHome;
      Bun.spawnSync(["rm", "-rf", TEST_HOME]);
    }
  });
});
