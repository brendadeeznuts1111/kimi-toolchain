/**
 * Smoke test — BUN_OPTIONS with bun build --compile standalone executable.
 *
 * Ported from oven-sh/bun test/cli/env/bun-options.test.ts @ pinned commit.
 * Validates the 1.3.7 fix: BUN_OPTIONS applied to standalone executables.
 * Requires Bun >= 1.3.7 for --cpu-prof flag support.
 */

import { describe, expect, test } from "bun:test";
import { probeBunOptionsCpuProfCompile } from "../src/lib/bun-cli-contract-probes.ts";

const BUN_AT_LEAST_1_3_7 = Bun.semver.satisfies(Bun.version, ">=1.3.7");

describe("bun-cli-bun-options-compile", () => {
  test("BUN_OPTIONS works with bun build --compile standalone executable", async () => {
    if (!BUN_AT_LEAST_1_3_7) {
      console.warn("Skipping — --cpu-prof requires Bun >= 1.3.7, got", Bun.version);
      return;
    }
    const result = await probeBunOptionsCpuProfCompile();
    expect(result.ok).toBe(true);
  }, 90_000); // bun build --compile is heavy
});
