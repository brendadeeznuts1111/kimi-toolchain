import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ConstantsRegistry,
  ConstantsRegistryLive,
  TestConstants,
} from "../../src/lib/constants-registry.ts";

function writeBunfig(dir: string, body: string): void {
  writeFileSync(join(dir, "bunfig.toml"), body);
}

describe("constants-registry effect layer", () => {
  test("live layer reads bunfig define values", async () => {
    const dir = join(tmpdir(), `constants-registry-live-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
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

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ConstantsRegistryLive(dir)))
    );
    expect(result.value).toBe(32);
    expect(result.hasMissing).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("test layer overrides do not mutate live bunfig reads", async () => {
    const dir = join(tmpdir(), `constants-registry-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
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
    }).pipe(Effect.provide(TestConstants(dir, { KIMI_HOOK_VERIFIER_MAX_CYCLES: 7 })));

    const liveProgram = Effect.gen(function* () {
      const registry = yield* ConstantsRegistry;
      return yield* registry.get("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    }).pipe(Effect.provide(ConstantsRegistryLive(dir)));

    expect(await Effect.runPromise(overrideProgram)).toBe(7);
    expect(await Effect.runPromise(liveProgram)).toBe(32);

    rmSync(dir, { recursive: true, force: true });
  });
});
