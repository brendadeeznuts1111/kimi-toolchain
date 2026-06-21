import { describe, expect, test } from "bun:test";
import { buildArtifactGraphConvergenceBlock } from "../src/lib/artifact-graph-convergence.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("artifact-graph-convergence", () => {
  test("buildArtifactGraphConvergenceBlock matches pillar shape for toolchain", async () => {
    const block = await buildArtifactGraphConvergenceBlock(REPO_ROOT);
    expect(block.schemaVersion).toBe(1);
    expect(block.aligned).toBe(true);
    expect(block.bunRuntimeCapabilities).toMatchObject({
      inventoryKeys: 16,
      aligned: true,
    });
    expect(block.bunImage).toMatchObject({
      available: true,
      metadataProbe: "ok",
    });
    expect(block.context).toMatchObject({
      artifactStore: "ok",
      dag: "ok",
    });
  });
});
