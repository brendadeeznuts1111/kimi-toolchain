import { describe, expect, test } from "bun:test";
import { join } from "path";
import { listGates, getGate, resolveGateClosure } from "../src/gates/registry.ts";

const PROJECT_ROOT = join(import.meta.dir, "..");
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import "../src/gates/init.ts";



async function cleanupPath(path: string): Promise<void> {
  await Bun.spawn({ cmd: ["rm", "-rf", path] }).exited;
}

describe("gates-example", () => {
  test("registers all three example gates", () => {
    expect(listGates().sort()).toEqual(["data-freshness", "health-check", "strategy-check"]);
  });

  test("health-check gate is L1 and parallel", () => {
    const gate = getGate("health-check");
    expect(gate).toBeDefined();
    expect(gate?.level).toBe(1);
    expect(gate?.parallel).toBe(true);
  });

  test("strategy-check depends on health-check and data-freshness", () => {
    const gate = getGate("strategy-check");
    expect(gate?.dependsOn?.sort()).toEqual(["data-freshness", "health-check"]);
  });

  test("resolveGateClosure returns dependency-first order", () => {
    const { gates, missing } = resolveGateClosure("strategy-check");
    expect(missing).toEqual([]);
    expect(gates.map((g) => g.name)).toEqual(["data-freshness", "health-check", "strategy-check"]);
  });

  test("ArtifactStore saves and reads a gate envelope", async () => {
    const tmpDir = join(Bun.env.TMPDIR ?? "/tmp", `gates-test-${Date.now()}`);
    const store = new ArtifactStore(tmpDir);
    const path = await store.save("health-check", { status: "pass" }, 1);
    expect(path.startsWith(tmpDir)).toBe(true);

    const latest = await store.latest("health-check");
    expect(latest).not.toBeNull();
    expect(latest?.gate).toBe("health-check");
    expect(latest?.metadata?.bunVersion).toBe(Bun.version);

    expect(await store.count("health-check")).toBe(1);
    await cleanupPath(tmpDir);
  });

  test("dry-run produces an execution plan", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", `${PROJECT_ROOT}/src/bin/gate-doctor.ts`, "--all", "--dry-run", "--json"],
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) console.error("dry-run failed:", stderr);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.gates.map((g: { name: string }) => g.name)).toEqual([
      "data-freshness",
      "health-check",
      "strategy-check",
    ]);
  });
});
