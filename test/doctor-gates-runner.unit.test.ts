/** @description Doctor gate dependency runner — topo sort, cycles, closure, artifacts. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { resolveGateClosure } from "../src/gates/registry.ts";
import {
  detectCycle,
  generateGateGraph,
  runGatesWithDependencies,
  topologicalSort,
} from "../src/gates/runner.ts";
import type { Gate, GateArtifact, GateRunOptions, GateResult } from "../src/gates/types.ts";
import { withTempDir } from "./helpers.ts";

function mockGate(
  name: string,
  options: {
    dependsOn?: string[];
    status?: GateResult["status"];
    run?: (opts?: GateRunOptions) => Promise<GateResult>;
  } = {}
): Gate {
  return {
    name,
    description: `mock ${name}`,
    dependsOn: options.dependsOn,
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

  test("saveArtifact writes gate-graph composite when closure has multiple gates", async () => {
    await withTempDir("doctor-gates-graph-artifact-", async (dir) => {
      const gates = [mockGate("alpha"), mockGate("beta", { dependsOn: ["alpha"] })];
      const { graphArtifactPath } = await runGatesWithDependencies(gates, {
        projectRoot: dir,
        saveArtifact: true,
      });
      expect(graphArtifactPath).toContain(join(dir, ".kimi", "artifacts", "gate-graph"));
      expect(pathExists(graphArtifactPath!)).toBe(true);
      const payload = (await Bun.file(graphArtifactPath!).json()) as {
        mode: string;
        order: string[];
        mermaid: string;
      };
      expect(payload.mode).toBe("gate-graph");
      expect(payload.order).toEqual(["alpha", "beta"]);
      expect(payload.mermaid).toContain("alpha");
      expect(payload.mermaid).toContain("beta");
    });
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
