/** @description Doctor gate dependency runner — topo sort, cycles, closure, artifacts. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { resolveGateClosure } from "../src/gates/registry.ts";
import {
  detectCycle,
  findMissingGateDependencies,
  generateGateGraph,
  groupGatesIntoExecutionLevels,
  planGateExecution,
  runGatesWithDependencies,
  topologicalSort,
} from "../src/gates/runner.ts";
import { DEFAULT_GATE_ARTIFACT_LIMIT } from "../src/gates/types.ts";
import type { Gate, GateArtifact, GateRunOptions, GateResult } from "../src/gates/types.ts";
import { withTempDir } from "./helpers.ts";

function mockGate(
  name: string,
  options: {
    dependsOn?: string[];
    parallel?: boolean;
    retentionPolicy?: Gate["retentionPolicy"];
    status?: GateResult["status"];
    run?: (opts?: GateRunOptions) => Promise<GateResult>;
  } = {}
): Gate {
  return {
    name,
    description: `mock ${name}`,
    level: 2,
    dependsOn: options.dependsOn,
    ...(options.parallel ? { parallel: true } : {}),
    ...(options.retentionPolicy ? { retentionPolicy: options.retentionPolicy } : {}),
    run:
      options.run ??
      (async () => ({
        status: options.status ?? "pass",
      })),
  };
}

describe("doctor-gates-runner", () => {
  test("topologicalSort orders dependencies before dependents", () => {
    const gates = [
      mockGate("child", { dependsOn: ["parent"] }),
      mockGate("parent"),
      mockGate("root"),
    ];
    const order = topologicalSort(gates).map((g) => g.name);
    expect(order.indexOf("parent")).toBeLessThan(order.indexOf("child"));
    expect(order.indexOf("root")).toBeLessThan(order.indexOf("child"));
  });

  test("detectCycle reports circular dependsOn chains", () => {
    const gates = [mockGate("a", { dependsOn: ["b"] }), mockGate("b", { dependsOn: ["a"] })];
    expect(detectCycle(gates).sort()).toEqual(["a", "b"]);
  });

  test("findMissingGateDependencies flags dependsOn not present in gate array", () => {
    const gates = [mockGate("perf-gate", { dependsOn: ["bunfig-policy"] })];
    expect(findMissingGateDependencies(gates)).toEqual(["perf-gate → bunfig-policy"]);
  });

  test("runGatesWithDependencies rejects incomplete gate closure", async () => {
    const gates = [mockGate("perf-gate", { dependsOn: ["bunfig-policy"] })];
    await expect(runGatesWithDependencies(gates)).rejects.toThrow(/Gate closure incomplete/);
  });

  test("resolveGateClosure collects transitive dependencies", () => {
    const closure = resolveGateClosure("perf-gate");
    expect(closure.missing).toEqual([]);
    expect(closure.gates.map((g) => g.name)).toEqual(["bunfig-policy", "perf-gate"]);
  });

  test("runGatesWithDependencies runs dependents when a dependency warns", async () => {
    const gates = [
      mockGate("root", { status: "warn", dependsOn: [] }),
      mockGate("child", { dependsOn: ["root"] }),
    ];
    const { results } = await runGatesWithDependencies(gates);
    expect(results.map((r) => r.status)).toEqual(["warn", "pass"]);
  });

  test("runGatesWithDependencies blocks dependents when a dependency fails", async () => {
    const gates = [
      mockGate("root", { status: "fail", dependsOn: [] }),
      mockGate("child", { dependsOn: ["root"] }),
    ];
    const { results, order } = await runGatesWithDependencies(gates);
    expect(order).toEqual(["root", "child"]);
    expect(results[0]).toMatchObject({
      gate: "root",
      status: "fail",
      dependsOn: [],
      detail: { status: "fail" },
    });
    expect(results[1]).toEqual({
      gate: "child",
      status: "blocked",
      reason: "blocked by: root",
      dependsOn: ["root"],
    });
  });

  test("getArtifact exposes in-run dependency results", async () => {
    const gates = [
      mockGate("upstream", {
        run: async (opts) => {
          const artifact = await opts?.getArtifact?.("missing");
          expect(artifact).toBeNull();
          return { status: "pass", reason: "upstream-ok" };
        },
      }),
      mockGate("downstream", {
        dependsOn: ["upstream"],
        run: async (opts) => {
          const artifact = (await opts?.getArtifact?.("upstream")) as GateArtifact | null;
          expect(artifact?.payload).toMatchObject({ status: "pass", reason: "upstream-ok" });
          return { status: "pass" };
        },
      }),
    ];
    const { results } = await runGatesWithDependencies(gates);
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });

  test("getArtifacts exposes in-run result before saved history", async () => {
    await withTempDir("doctor-gates-context-history-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("upstream", { status: "pass", reason: "historical" });
      await Bun.sleep(2);

      const gates = [
        mockGate("upstream", {
          run: async () => ({ status: "pass", reason: "current" }),
        }),
        mockGate("downstream", {
          dependsOn: ["upstream"],
          run: async (opts) => {
            const latest = await opts?.getArtifacts?.("upstream", { limit: 1 });
            expect(latest).toEqual([{ status: "pass", reason: "current" }]);

            const artifacts = await opts?.getArtifacts?.("upstream", { limit: 2 });
            expect(artifacts).toEqual([
              { status: "pass", reason: "current" },
              { status: "pass", reason: "historical" },
            ]);
            return { status: "pass" };
          },
        }),
      ];

      const { results } = await runGatesWithDependencies(gates, {
        projectRoot: dir,
        saveArtifact: true,
      });
      expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
    });
  });

  test("saveArtifact writes run manifest grouping gate artifacts", async () => {
    await withTempDir("doctor-gates-run-manifest-", async (dir) => {
      const gates = [mockGate("alpha"), mockGate("beta", { dependsOn: ["alpha"] })];
      const { runId, runManifestPath } = await runGatesWithDependencies(gates, {
        projectRoot: dir,
        saveArtifact: true,
        triggeredBy: "test --save-artifact",
      });
      expect(runId).toMatch(/^run_/);
      expect(runManifestPath).toContain(join(dir, ".kimi", "artifacts", "runs"));

      const store = new ArtifactStore(dir);
      const manifest = await store.readRunManifest(runId!);
      expect(manifest?.gates).toEqual(["alpha", "beta"]);
      expect(manifest?.status).toBe("pass");
      expect(manifest?.triggeredBy).toBe("test --save-artifact");
      expect(Object.keys(manifest?.artifacts ?? {})).toEqual(
        expect.arrayContaining(["alpha", "beta", "gate-graph"])
      );

      const alphaEnvelope = await store.readEnvelope(manifest!.artifacts.alpha!);
      expect(alphaEnvelope?.metadata?.runId).toBe(runId);
    });
  });

  test("nested gate run inherits parentRunId from ambient KIMI_RUN_ID", async () => {
    await withTempDir("doctor-gates-nested-run-", async (dir) => {
      const prevRun = Bun.env.KIMI_RUN_ID;
      Bun.env.KIMI_RUN_ID = "run_outer_parent";
      try {
        const gates = [mockGate("nested-alpha")];
        const { runId, runManifestPath } = await runGatesWithDependencies(gates, {
          projectRoot: dir,
          saveArtifact: true,
        });
        expect(runId).not.toBe("run_outer_parent");
        const store = new ArtifactStore(dir);
        const manifest = await store.readRunManifest(runId!);
        expect(manifest?.parentRunId).toBe("run_outer_parent");
        expect(runManifestPath).toContain(runId!);
      } finally {
        if (prevRun === undefined) delete Bun.env.KIMI_RUN_ID;
        else Bun.env.KIMI_RUN_ID = prevRun;
      }
    });
  });

  test("saveArtifact writes gate-graph composite when closure has multiple gates", async () => {
    await withTempDir("doctor-gates-graph-artifact-", async (dir) => {
      const gates = [mockGate("alpha"), mockGate("beta", { dependsOn: ["alpha"] })];
      const { graphArtifactPath } = await runGatesWithDependencies(gates, {
        projectRoot: dir,
        saveArtifact: true,
      });
      expect(graphArtifactPath).toContain(join(dir, ".kimi", "artifacts", "gate-graph"));
      expect(pathExists(graphArtifactPath!)).toBe(true);
      const envelope = (await Bun.file(graphArtifactPath!).json()) as {
        payload: { mode: string; order: string[]; mermaid: string };
      };
      const payload = envelope.payload;
      expect(payload.mode).toBe("gate-graph");
      expect(payload.order).toEqual(["alpha", "beta"]);
      expect(payload.mermaid).toContain("alpha");
      expect(payload.mermaid).toContain("beta");
    });
  });

  test("planGateExecution returns topological order without running gates", () => {
    const plan = planGateExecution([
      mockGate("child", { dependsOn: ["parent"] }),
      mockGate("parent"),
    ]);
    expect(plan.order).toEqual(["parent", "child"]);
    expect(plan.gates).toEqual([
      { name: "parent", description: "mock parent", dependsOn: [] },
      { name: "child", description: "mock child", dependsOn: ["parent"] },
    ]);
  });

  test("runGatesWithDependencies persists upstream lineage on saved artifacts", async () => {
    await withTempDir("doctor-gates-lineage-", async (dir) => {
      const gates = [
        mockGate("bunfig-policy", {
          run: async () => ({ status: "pass" }),
        }),
        mockGate("perf-gate", {
          dependsOn: ["bunfig-policy"],
          run: async (opts) => {
            const upstream = await opts?.getArtifact?.("bunfig-policy");
            expect(upstream?.relativePath).toMatch(/^\.kimi\/artifacts\/bunfig-policy\//);
            const artifacts = await opts?.getArtifacts?.("bunfig-policy", { limit: 1 });
            expect(artifacts).toHaveLength(1);
            return { status: "pass", reason: "seen-upstream" };
          },
        }),
      ];

      const { results } = await runGatesWithDependencies(gates, {
        projectRoot: dir,
        saveArtifact: true,
      });

      const perf = results.find((row) => row.gate === "perf-gate");
      expect(perf?.detail?.lineage).toMatchObject({
        dependencies: ["bunfig-policy"],
        upstreamArtifacts: [expect.stringMatching(/^\.kimi\/artifacts\/bunfig-policy\//)],
      });

      const store = new ArtifactStore(dir);
      const perfRelative = store.relativePath(perf!.artifactPath!);
      const envelope = await store.readEnvelope(perfRelative);
      expect(envelope?.metadata?.lineage).toMatchObject({
        dependencies: ["bunfig-policy"],
        upstreamArtifacts: [expect.stringMatching(/^\.kimi\/artifacts\/bunfig-policy\//)],
      });
      const dependsOn = envelope?.metadata?.dependsOn as Array<{ gate: string; paths?: string[] }>;
      expect(dependsOn?.[0]?.gate).toBe("bunfig-policy");
      expect(dependsOn?.[0]?.paths?.[0]).toMatch(/^\.kimi\/artifacts\/bunfig-policy\//);
    });
  });

  test("groupGatesIntoExecutionLevels batches independent roots at depth 0", () => {
    const levels = groupGatesIntoExecutionLevels([
      mockGate("child", { dependsOn: ["parent"] }),
      mockGate("parent"),
      mockGate("sibling"),
    ]);
    expect(levels[0]?.map((g) => g.name).sort()).toEqual(["parent", "sibling"]);
    expect(levels[1]?.map((g) => g.name)).toEqual(["child"]);
  });

  test("getArtifacts defaults to DEFAULT_GATE_ARTIFACT_LIMIT when limit omitted", async () => {
    await withTempDir("doctor-gates-artifact-limit-", async (dir) => {
      const store = new ArtifactStore(dir);
      for (let i = 0; i < DEFAULT_GATE_ARTIFACT_LIMIT + 5; i++) {
        await store.save("upstream", { status: "pass", index: i });
        await Bun.sleep(2);
      }

      const gates = [
        mockGate("consumer", {
          run: async (opts) => {
            const artifacts = await opts?.getArtifacts?.("upstream");
            expect(artifacts).toHaveLength(DEFAULT_GATE_ARTIFACT_LIMIT);
            return { status: "pass" };
          },
        }),
      ];

      const { results } = await runGatesWithDependencies(gates, { projectRoot: dir });
      expect(results[0]?.status).toBe("pass");
    });
  });

  test("runGatesWithDependencies invokes onFailure for fail and blocked gates", async () => {
    const failures: string[] = [];
    const gates = [
      mockGate("root", { status: "fail", dependsOn: [] }),
      mockGate("child", { dependsOn: ["root"] }),
    ];
    await runGatesWithDependencies(gates, {
      onFailure: async (result) => {
        failures.push(`${result.gate}:${result.status}`);
      },
    });
    expect(failures).toEqual(["root:fail", "child:blocked"]);
  });

  test("runGatesWithDependencies applies retentionPolicy after saveArtifact", async () => {
    await withTempDir("doctor-gates-retention-", async (dir) => {
      const store = new ArtifactStore(dir);
      for (let i = 0; i < 4; i++) {
        await store.save("upstream", { n: i });
        await Bun.sleep(2);
      }

      const gates = [
        mockGate("upstream", {
          retentionPolicy: { maxCount: 2 },
          run: async () => ({ status: "pass" }),
        }),
      ];

      await runGatesWithDependencies(gates, { projectRoot: dir, saveArtifact: true });
      expect(await store.list("upstream")).toHaveLength(2);
    });
  });

  test("runGatesWithDependencies runs parallel gates at the same level concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const timedParallelGate = (name: string) =>
      mockGate(name, {
        parallel: true,
        run: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Bun.sleep(40);
          inFlight -= 1;
          return { status: "pass" };
        },
      });

    await runGatesWithDependencies([timedParallelGate("alpha"), timedParallelGate("beta")]);
    expect(maxInFlight).toBe(2);
  });

  test("generateGateGraph emits Mermaid edges for dependsOn", () => {
    const graph = generateGateGraph([
      mockGate("bunfig-policy"),
      mockGate("perf-gate", { dependsOn: ["bunfig-policy"] }),
    ]);
    expect(graph).toContain("graph TD");
    expect(graph).toContain("bunfig-policy[bunfig-policy] --> perf-gate[perf-gate]");
  });
});
