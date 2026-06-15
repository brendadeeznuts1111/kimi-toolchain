import { describe, expect, it } from "bun:test";
import { inferContractFromObservations } from "../src/lib/contract-inference.ts";
import { verifyHookCycleLength } from "../src/lib/hook-verifier.ts";
import { contractObservationsPath } from "../src/lib/paths.ts";

/** @see types/build-constants.d.ts · bunfig.toml `[define]` */
describe("buildConstants", () => {
  it("should load compile-time tuning values from bunfig define", () => {
    expect(EMBEDDING_DIM).toBe(384);
    expect(DECISION_SCORE_WINDOW_DAYS).toBe(7);
    expect(CLUSTER_SIMILARITY_THRESHOLD).toBe(0.55);
    expect(HOOK_VERIFIER_MAX_CYCLES).toBe(32);
    expect(KIMI_CONTRACT_SCHEMA_VERSION).toBe("1.0.0");
    expect(ENABLE_CONTRACT_INFERENCE).toBe(true);
  });

  it("should resolve contract observations path from define", () => {
    const path = contractObservationsPath("/tmp/project");
    expect(path).toEndWith(".kimi/var/contract-observations.ndjson");
  });

  it("should run contract inference when enabled", () => {
    const result = inferContractFromObservations("/tmp/project");
    expect(result.skipped).toBeUndefined();
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.observationsPath).toBe(contractObservationsPath("/tmp/project"));
  });

  it("should enforce hook cycle limit from define", () => {
    expect(verifyHookCycleLength(HOOK_VERIFIER_MAX_CYCLES).ok).toBe(true);
    expect(verifyHookCycleLength(HOOK_VERIFIER_MAX_CYCLES + 1).ok).toBe(false);
  });
});
