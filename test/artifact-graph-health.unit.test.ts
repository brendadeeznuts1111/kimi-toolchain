import { describe, expect, test } from "bun:test";
import {
  auditArtifactGraphHealth,
  evaluateArtifactGraphProbeHandoffCondition,
} from "../src/lib/artifact-graph-health.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("artifact-graph-health", () => {
  test("auditArtifactGraphHealth passes for toolchain root", async () => {
    const health = await auditArtifactGraphHealth(REPO_ROOT);
    expect(health.applicable).toBe(true);
    expect(health.aligned).toBe(true);
    expect(health.checks.some((check) => check.name === "artifact-graph:gate-dag")).toBe(true);
    expect(health.checks.some((check) => check.name === "artifact-graph:context")).toBe(true);
  });

  test("evaluateArtifactGraphProbeHandoffCondition accepts context probe", async () => {
    const result = await evaluateArtifactGraphProbeHandoffCondition(
      "artifact-graph:context",
      REPO_ROOT
    );
    expect(result.ok).toBe(true);
  });
});
