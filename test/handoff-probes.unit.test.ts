import { describe, expect, test } from "bun:test";
import { evaluateHandoffProbeCondition } from "../src/lib/handoff-probes.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("handoff-probes", () => {
  test("evaluates bun-install runtime-api-docs probe", async () => {
    const result = await evaluateHandoffProbeCondition("bun-install:runtime-api-docs", REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  test("evaluates bun-install capabilities probe", async () => {
    const result = await evaluateHandoffProbeCondition("bun-install:capabilities", REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  test("evaluates bun-install bun-image probe", async () => {
    const result = await evaluateHandoffProbeCondition("bun-install:bun-image", REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  test("evaluates artifact-graph context probe", async () => {
    const result = await evaluateHandoffProbeCondition("artifact-graph:context", REPO_ROOT);
    expect(result.ok).toBe(true);
  });
});
