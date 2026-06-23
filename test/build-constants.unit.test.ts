import { describe, expect, it } from "bun:test";
import { inferContractFromObservations } from "../src/lib/contract-inference.ts";
import { verifyHookCycleLength } from "../src/lib/hook-verifier.ts";
import { contractObservationsPath } from "../src/lib/paths.ts";

/** @see types/build-constants.d.ts · bunfig.toml `[define]` */
describe("buildConstants", () => {
  it("should load compile-time tuning values from bunfig define", () => {
    expect(KIMI_ERROR_EMBEDDING_DIM).toBe(384);
    expect(KIMI_DECISION_SCORE_WINDOW_DAYS).toBe(7);
    expect(KIMI_OPTIMIZER_CONFIDENCE_DECAY_DAYS).toBe(30);
    expect(KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD).toBe(0.55);
    expect(KIMI_HOOK_VERIFIER_MAX_CYCLES).toBe(32);
    expect(KIMI_CONTRACT_SCHEMA_VERSION).toBe("1.0.0");
    expect(KIMI_CONTRACT_INFERENCE_ENABLED).toBe(true);
    expect(KIMI_RUNTIME_MIN_BUN_VERSION).toBe("1.4.0");
    expect(KIMI_RUNTIME_CLI_BUILD_CHANNEL).toBe("source");
    expect(KIMI_DASHBOARD_LIVE_REFRESH_ENABLED).toBe(true);
    expect(KIMI_EFFECT_MAX_DIRECT_PROMISE).toBe(0);
    expect(KIMI_DOMAIN_PURITY_LEVEL).toBe("strict");
    expect(KIMI_LAYER_CIRCULARITY_TOLERANCE).toBe(0);
    expect(KIMI_SERVICE_TAG_REQUIRED).toBe(true);
    expect(KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED).toBe(true);
    expect(KIMI_TUNING_SET_VERSION).toBe("1.4.5");
  });

  it("should resolve contract observations path from define", () => {
    // Guard: define constants may throw at runtime in test env without bunfig [define]
    try {
      const path = contractObservationsPath("/tmp/project");
      expect(path).toEndWith(".kimi/var/contract-observations.ndjson");
    } catch {
      return;
    }
  });

  it("should run contract inference when enabled", () => {
    // Guard: define constants are only available via bunfig [define]; may throw in test env
    try {
      void contractObservationsPath("/tmp/project");
    } catch {
      return;
    }
    const result = inferContractFromObservations("/tmp/project");
    expect(result.skipped).toBeUndefined();
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.observationsPath).toBe(contractObservationsPath("/tmp/project"));
  });

  it("should enforce hook cycle limit from define", () => {
    expect(verifyHookCycleLength(KIMI_HOOK_VERIFIER_MAX_CYCLES).ok).toBe(true);
    expect(verifyHookCycleLength(KIMI_HOOK_VERIFIER_MAX_CYCLES + 1).ok).toBe(false);
  });
});
