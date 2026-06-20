import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  analyzeDefineDiff,
  checkTuningSetFreshness,
  requiresTuningSetBump,
  TUNING_SET_VERSION_KEY,
} from "../src/lib/tuning-set-version.ts";

describe("tuningSetVersion", () => {
  it("should require bump when define keys change without version bump", () => {
    const diff = `
--- a/bunfig.toml
+++ b/bunfig.toml
@@
-KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
+KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`;
    const analysis = analyzeDefineDiff(diff);
    expect(analysis.changedDefineKeys.has("KIMI_HOOK_VERIFIER_MAX_CYCLES")).toBe(true);
    expect(requiresTuningSetBump(analysis)).toBe(true);
  });

  it("should pass when tuning set version is bumped with define changes", () => {
    const diff = `
--- a/bunfig.toml
+++ b/bunfig.toml
@@
-KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
+KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
-KIMI_TUNING_SET_VERSION = '"1.0.0"'
+KIMI_TUNING_SET_VERSION = '"1.1.0"'
`;
    const analysis = analyzeDefineDiff(diff);
    expect(analysis.tuningVersionChanged).toBe(true);
    expect(requiresTuningSetBump(analysis)).toBe(false);
  });

  it("should detect declare const changes in types file", () => {
    const diff = `
--- a/types/build-constants.d.ts
+++ b/types/build-constants.d.ts
@@
+declare const KIMI_NEW_CONSTANT: number;
`;
    const analysis = analyzeDefineDiff(diff);
    expect(analysis.changedTypeKeys.has("KIMI_NEW_CONSTANT")).toBe(true);
    expect(requiresTuningSetBump(analysis)).toBe(true);
  });

  it("should report aligned tuning set for toolchain repo", async () => {
    const root = join(import.meta.dir, "..");
    const report = await checkTuningSetFreshness(root);
    expect(report.applicable).toBe(true);
    expect(report.currentVersion).toBe("1.4.4");
    expect(report.expectedVersion).toBe("1.4.4");
    expect(report.aligned).toBe(true);
  });

  it("should expose canonical define key", () => {
    expect(TUNING_SET_VERSION_KEY).toBe("KIMI_TUNING_SET_VERSION");
  });
});
