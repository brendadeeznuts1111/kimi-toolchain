import { describe, expect, test } from "bun:test";
import { buildArtifactGraphConvergenceBlock } from "../src/lib/artifact-graph-convergence.ts";
import { RUNTIME_CAPABILITY_INVENTORY_KEYS } from "../src/lib/bun-install-config.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("artifact-graph-convergence", () => {
  test("buildArtifactGraphConvergenceBlock matches pillar shape for toolchain", async () => {
    const block = await buildArtifactGraphConvergenceBlock(REPO_ROOT);
    expect(block.schemaVersion).toBe(1);
    expect(block.aligned).toBe(true);
    expect(block.bunRuntimeCapabilities).toMatchObject({
      inventoryKeys: RUNTIME_CAPABILITY_INVENTORY_KEYS.length,
      aligned: true,
    });
    expect(block.publish).toMatchObject({ dryRun: "ok" });
    expect(block.bunImage).toMatchObject({
      available: true,
      metadataProbe: "ok",
    });
    expect(block.context).toMatchObject({
      artifactStore: "ok",
      dag: "ok",
    });
    expect(Array.isArray(block.fixPlan)).toBe(true);
    expect(block.fixPlan.length).toBe(0);
  });

  test("apiArtifactGraphConvergenceSchema returns versioned schema with three pillars", async () => {
    const { apiArtifactGraphConvergenceSchema } =
      await import("../examples/dashboard/src/handlers/artifact-graph-convergence.ts");
    const res = await apiArtifactGraphConvergenceSchema();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      generatedAt: string;
      ok: boolean;
      pillars: { id: string }[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.generatedAt).toBeDefined();
    expect(body.ok).toBe(true);
    expect(body.pillars).toHaveLength(3);
    expect(body.pillars.map((p) => p.id)).toEqual(["convergence", "context", "runtime"]);
  });

  test("Transpiler.scan exports match actual module exports", async () => {
    const { apiArtifactGraphConvergenceSchema } =
      await import("../examples/dashboard/src/handlers/artifact-graph-convergence.ts");
    const res = await apiArtifactGraphConvergenceSchema();
    const body = (await res.json()) as {
      pillars: { id: string; exports: { name: string }[] }[];
    };
    const convergencePillar = body.pillars.find((p) => p.id === "convergence");
    const actual = await import("../src/lib/artifact-graph-convergence.ts");
    for (const exp of convergencePillar!.exports) {
      expect(actual).toHaveProperty(exp.name);
    }
  });

  test("schema cache returns same payload when files unchanged", async () => {
    const { apiArtifactGraphConvergenceSchema } =
      await import("../examples/dashboard/src/handlers/artifact-graph-convergence.ts");
    const res1 = await apiArtifactGraphConvergenceSchema();
    const body1 = (await res1.json()) as { generatedAt: string };
    const res2 = await apiArtifactGraphConvergenceSchema();
    const body2 = (await res2.json()) as { generatedAt: string };
    expect(body1.generatedAt).toBe(body2.generatedAt);
  });

  test("discovered exports include expected public surface", async () => {
    const { apiArtifactGraphConvergenceSchema } =
      await import("../examples/dashboard/src/handlers/artifact-graph-convergence.ts");
    const res = await apiArtifactGraphConvergenceSchema();
    const body = (await res.json()) as {
      pillars: { exports: { name: string }[] }[];
    };
    const allExports = body.pillars.flatMap((p) => p.exports.map((e) => e.name));
    expect(allExports).toContain("buildArtifactGraphConvergenceBlock");
    expect(allExports).toContain("auditArtifactGraphHealth");
    expect(allExports).toContain("auditRuntimeCapabilitiesHealth");
    expect(allExports).toContain("evaluateArtifactGraphProbeHandoffCondition");
  });
});
