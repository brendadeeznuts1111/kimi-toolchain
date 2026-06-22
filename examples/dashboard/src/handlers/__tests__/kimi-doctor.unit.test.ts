import { describe, expect, test } from "bun:test";
import { apiKimiDoctor } from "../kimi-doctor.ts";

describe("dashboard-kimi-doctor-api", () => {
  test("apiKimiDoctor documents perf-doctor and kimi-doctor surfaces", async () => {
    const res = await apiKimiDoctor();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.perfDoctor.commands.length).toBeGreaterThanOrEqual(5);
    expect(body.perfDoctor.npmScripts["perf:watch"]).toContain("file-triggered");
    expect(body.threeSurfaces).toHaveLength(3);
    expect(body.kimiDoctor.gateCommands).toContain("kimi-doctor --gate perf-gate --save-artifact");
    expect(body.lineageGates).toContain("perf-gate");
    expect(body.commands.length).toBeGreaterThan(0);
    expect(body.refresh?.fastQuery).toBe("?fast=1");
  });

  test("apiKimiDoctor includes live benchmark, effect-gates, and artifact probes", async () => {
    const res = await apiKimiDoctor();
    const body = await res.json();
    expect(body.live).toBeDefined();
    expect(body.live.perf.registrySize).toBeGreaterThan(0);
    expect(typeof body.live.perf.allPass).toBe("boolean");
    expect(body.live.perf.registryRoute).toBe("/api/perf-registry");
    expect(body.live.perf.registryCardId).toBe("card-perf-registry");
    expect(Array.isArray(body.live.perf.metrics)).toBe(true);
    expect(body.live.effectGates).toBeDefined();
    expect(typeof body.live.effectGates.ok).toBe("boolean");
    expect(body.live.effectGates.route).toBe("/api/gates");
    expect(body.live.artifacts.lineageGates).toEqual(["perf-gate", "bunfig-policy", "card-probe"]);
    expect(body.live.artifacts.gates).toHaveLength(3);
    expect(typeof body.live.artifacts.savedCount).toBe("number");
    expect(typeof body.live.files.thresholdsJson).toBe("boolean");
    expect(body.fetchedAt).toBe(body.live.fetchedAt);
    expect(body.allPass).toBe(body.live.perf.allPass);
    expect(body.ok).toBe(body.live.ok);
  });

  test("apiKimiDoctor fast mode skips effect-gates scan", async () => {
    const res = await apiKimiDoctor(new Request("http://127.0.0.1/api/kimi-doctor?fast=1"));
    const body = await res.json();
    expect(body.live.perf.registrySize).toBeGreaterThan(0);
    expect(body.live.effectGates).toBeUndefined();
  });

  test("apiKimiDoctor effectGatesOnly returns discipline probe", async () => {
    const res = await apiKimiDoctor(
      new Request("http://127.0.0.1/api/kimi-doctor?effectGatesOnly=1")
    );
    const body = await res.json();
    expect(body.effectGates).toBeDefined();
    expect(typeof body.effectGates.ok).toBe("boolean");
    expect(body.live.effectGates).toEqual(body.effectGates);
    expect(body.perfDoctor).toBeUndefined();
  });
});
