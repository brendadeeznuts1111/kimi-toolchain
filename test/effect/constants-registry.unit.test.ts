import { makeDir, removePath, writeText } from "../../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "path";
import { testTempDir } from "../helpers.ts";
import { runWithLayer } from "../effect-helpers.ts";
import {
  ConstantsRegistry,
  ConstantsRegistryLive,
  TestConstants,
  validateConstant,
} from "../../src/lib/constants-registry.ts";

function writeBunfig(dir: string, body: string): void {
  writeText(join(dir, "bunfig.toml"), body);
}

describe("constants-registry effect layer", () => {
  test("live layer reads bunfig define values", async () => {
    const dir = testTempDir("constants-registry-live-");
    makeDir(dir, { recursive: true });
    writeBunfig(
      dir,
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
`
    );

    const program = Effect.gen(function* () {
      const registry = yield* ConstantsRegistry;
      const value = yield* registry.get("KIMI_HOOK_VERIFIER_MAX_CYCLES");
      const hasMissing = yield* registry.has("KIMI_MISSING");
      return { value, hasMissing };
    });

    const result = await runWithLayer(program, ConstantsRegistryLive(dir));
    expect(result.value).toBe(32);
    expect(result.hasMissing).toBe(false);

    removePath(dir, { recursive: true, force: true });
  });

  test("test layer overrides do not mutate live bunfig reads", async () => {
    const dir = testTempDir("constants-registry-test-");
    makeDir(dir, { recursive: true });
    writeBunfig(
      dir,
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
`
    );

    const overrideProgram = Effect.gen(function* () {
      const registry = yield* ConstantsRegistry;
      return yield* registry.get("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    });

    const liveProgram = Effect.gen(function* () {
      const registry = yield* ConstantsRegistry;
      return yield* registry.get("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    });

    expect(
      await runWithLayer(overrideProgram, TestConstants(dir, { KIMI_HOOK_VERIFIER_MAX_CYCLES: 7 }))
    ).toBe(7);
    expect(await runWithLayer(liveProgram, ConstantsRegistryLive(dir))).toBe(32);

    removePath(dir, { recursive: true, force: true });
  });

  test("validateConstant enforces type and numeric restrictions", () => {
    expect(
      validateConstant("KIMI_HOOK_VERIFIER_MAX_CYCLES", 32, {
        type: "number",
        min: 1,
        integer: true,
      })
    ).toBeNull();
    expect(
      validateConstant("KIMI_HOOK_VERIFIER_MAX_CYCLES", "32", {
        type: "number",
        min: 1,
        integer: true,
      })?.reason
    ).toContain("expected number");
    expect(
      validateConstant("KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD", 1.5, {
        type: "number",
        min: 0,
        max: 1,
      })?.reason
    ).toContain("expected <= 1");
  });
});
