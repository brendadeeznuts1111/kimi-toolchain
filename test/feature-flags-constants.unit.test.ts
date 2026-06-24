import { describe, expect, test } from "bun:test";
import {
  BUNDLE_FEATURE_KEYS,
  ENV_ESCAPE_FLAG_KEYS,
  FEATURE_FLAG_DEFINITIONS,
} from "../src/lib/feature-flags-constants.ts";
import {
  getFeatureFlagById,
  isEnvFlagEnabled,
  listFeatureFlags,
} from "../src/lib/feature-flags.ts";
import { lintFeatureFlagsRegistry } from "../src/lib/feature-flags-registry-lint.ts";
import { REPO_ROOT, withClearedEnv } from "./helpers.ts";

describe("feature-flags-constants", () => {
  test("FEATURE_FLAG_DEFINITIONS ids are unique", () => {
    const ids = FEATURE_FLAG_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("bundle keys align with features.ts exports", () => {
    const fromDefs = FEATURE_FLAG_DEFINITIONS.filter((d) => d.kind === "bundle").map((d) => d.key);
    expect([...BUNDLE_FEATURE_KEYS]).toEqual(fromDefs);
  });

  test("getFeatureFlagById resolves escape hatches", () => {
    const def = getFeatureFlagById("skip-effect-gates");
    expect(def?.key).toBe("KIMI_SKIP_EFFECT_GATES");
    expect(def?.kind).toBe("env-escape");
  });

  test("isEnvFlagEnabled respects env", () => {
    withClearedEnv(["KIMI_SKIP_EFFECT_GATES"], () => {
      expect(isEnvFlagEnabled("KIMI_SKIP_EFFECT_GATES")).toBe(false);
      Bun.env.KIMI_SKIP_EFFECT_GATES = "1";
      expect(isEnvFlagEnabled("KIMI_SKIP_EFFECT_GATES")).toBe(true);
    });
  });

  test("listFeatureFlags filters by kind", () => {
    expect(listFeatureFlags("bundle").every((d) => d.kind === "bundle")).toBe(true);
    expect(listFeatureFlags("env-escape").length).toBe(ENV_ESCAPE_FLAG_KEYS.length);
  });

  test("lintFeatureFlagsRegistry passes for canonical registry", async () => {
    const errors = (await lintFeatureFlagsRegistry(REPO_ROOT)).filter(
      (i) => i.severity === "error"
    );
    expect(errors).toEqual([]);
  });
});
