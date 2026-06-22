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
  });
});
