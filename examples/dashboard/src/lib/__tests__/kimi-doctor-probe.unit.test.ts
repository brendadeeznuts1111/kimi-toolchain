import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "../../../../../test/helpers.ts";
import {
  KIMI_DOCTOR_LINEAGE_GATES,
  probeKimiDoctorEffectGates,
  probeKimiDoctorLive,
} from "../kimi-doctor-probe.ts";

describe("kimi-doctor-probe", () => {
  test("probeKimiDoctorLive returns perf metrics and lineage artifact rows", async () => {
    const dashboardDir = join(REPO_ROOT, "examples/dashboard");
    const live = await probeKimiDoctorLive(REPO_ROOT, { dashboardDir });

    expect(live.perf.registrySize).toBeGreaterThan(0);
    expect(live.perf.registryRoute).toBe("/api/perf-registry");
    expect(typeof live.perf.allPass).toBe("boolean");
    expect(live.artifacts.lineageGates).toEqual([...KIMI_DOCTOR_LINEAGE_GATES]);
    expect(live.artifacts.gates).toHaveLength(KIMI_DOCTOR_LINEAGE_GATES.length);
    expect(live.files.dashboardDir).toBe(dashboardDir);
    expect(typeof live.ok).toBe("boolean");
    expect(live.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("probeKimiDoctorEffectGates returns discipline summary", async () => {
    const effectGates = await probeKimiDoctorEffectGates(REPO_ROOT);
    expect(typeof effectGates.ok).toBe("boolean");
    expect(effectGates.route).toBe("/api/gates");
    expect(typeof effectGates.summary.total).toBe("number");
    expect(Array.isArray(effectGates.violations)).toBe(true);
  });

  test("probeKimiDoctorLive includes effectGates when requested", async () => {
    const dashboardDir = join(REPO_ROOT, "examples/dashboard");
    const live = await probeKimiDoctorLive(REPO_ROOT, {
      dashboardDir,
      includeEffectGates: true,
    });
    expect(live.effectGates).toBeDefined();
    expect(typeof live.effectGates?.ok).toBe("boolean");
  });
});
