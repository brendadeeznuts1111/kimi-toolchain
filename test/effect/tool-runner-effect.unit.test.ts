import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokeToolEffect, runToolEffect } from "../../src/lib/effect/tool-runner-effect.ts";
import { ExitNonZero, ToolNotFound, ToolTimeout } from "../../src/lib/effect/errors.ts";

function tmpScript(content: string): string {
  const dir = join(tmpdir(), `kimi-tool-effect-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "script.ts");
  writeFileSync(path, content);
  return path;
}

describe("tool-runner-effect", () => {
  test("invokeToolEffect succeeds on exit 0", async () => {
    const script = tmpScript(`console.log("ok");`);
    const result = await Effect.runPromise(invokeToolEffect(script, []));
    expect(result.exitCode).toBe(0);
    expect(result.isError).toBe(false);
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test("invokeToolEffect fails with ExitNonZero on non-zero exit", async () => {
    const script = tmpScript(`console.error("fail"); process.exit(3);`);
    const exit = await Effect.runPromiseExit(invokeToolEffect(script, []));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toBeInstanceOf(ExitNonZero);
      expect((exit.cause.error as ExitNonZero).exitCode).toBe(3);
    }
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test(
    "invokeToolEffect fails with ToolTimeout on timeout",
    async () => {
      const script = tmpScript(`setTimeout(() => {}, 60000);`);
      const exit = await Effect.runPromiseExit(
        invokeToolEffect(script, [], { timeoutMs: 100, gracePeriodMs: 50 })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toBeInstanceOf(ToolTimeout);
        expect((exit.cause.error as ToolTimeout).timeoutMs).toBe(100);
      }
      rmSync(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 5000 }
  );

  test("runToolEffect fails with ToolNotFound when tool missing", async () => {
    const tmpHome = join(tmpdir(), `kimi-tool-effect-home-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpHome, { recursive: true });
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = tmpHome;

    try {
      const exit = await Effect.runPromiseExit(runToolEffect("definitely-missing-tool-xyz", []));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toBeInstanceOf(ToolNotFound);
        expect((exit.cause.error as ToolNotFound).tool).toBe("definitely-missing-tool-xyz");
      }
    } finally {
      Bun.env.HOME = prevHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
