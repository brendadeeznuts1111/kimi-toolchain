import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { EffectCliContractError } from "../../src/lib/effect/errors.ts";
import {
  createCliEffect,
  createMachineWriterEffect,
  parseCliFlagsEffect,
} from "../../src/lib/effect/cli-contract-effect.ts";

function captureStdout(): { data: string[]; restore: () => void } {
  const original = process.stdout.write.bind(process.stdout);
  const data: string[] = [];
  process.stdout.write = (chunk: string | Uint8Array) => {
    data.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  return {
    data,
    restore: () => {
      process.stdout.write = original;
    },
  };
}

function captureStderr(): { data: string[]; restore: () => void } {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const data: string[] = [];
  console.error = (msg: string) => data.push(msg);
  console.warn = (msg: string) => data.push(msg);
  return {
    data,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

describe("cli-contract-effect", () => {
  test("parseCliFlagsEffect succeeds with parsed flags", async () => {
    const program = parseCliFlagsEffect(
      ["bun", "kimi-doctor", "--json", "--timeout", "2500", "score"],
      "kimi-doctor"
    );
    const result = await Effect.runPromise(program);
    expect(result.json).toBe(true);
    expect(result.timeout).toBe(2500);
    expect(result.positional).toEqual(["score"]);
  });

  test("parseCliFlagsEffect fails with EffectCliContractError on unknown strict flag", async () => {
    const program = parseCliFlagsEffect(["bun", "kimi-doctor", "--unknown-flag"], "kimi-doctor", {
      strict: true,
    });
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toBeInstanceOf(EffectCliContractError);
      const error = exit.cause.error as EffectCliContractError;
      expect(error.toolName).toBe("kimi-doctor");
      expect(error.message).toContain("--unknown-flag");
      expect(error.unknownFlag).toBe("--unknown-flag");
    }
  });

  test("createMachineWriterEffect produces Effect output methods", async () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      const program = Effect.gen(function* () {
        const writer = yield* createMachineWriterEffect(
          {
            json: true,
            quiet: true,
            debug: false,
            bail: false,
            stepBudget: false,
            positional: [],
          },
          "kimi-test"
        );
        yield* writer.writeJson({ ok: true });
        yield* writer.info("suppressed info");
        yield* writer.error("visible error");
        return writer.flags.json;
      });

      const jsonMode = await Effect.runPromise(program);
      expect(jsonMode).toBe(true);
      expect(stdout.data).toHaveLength(1);
      expect(JSON.parse(stdout.data[0]!)).toEqual({
        ok: true,
        schemaVersion: 1,
        tool: "kimi-test",
      });
      expect(stderr.data).toContain("  ✗ visible error");
      expect(stderr.data).not.toContain("suppressed info");
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  test("createCliEffect parses argv and writes JSON through Effect", async () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      const program = Effect.gen(function* () {
        const writer = yield* createCliEffect(["bun", "kimi-test", "--json"], "kimi-test");
        yield* writer.writeJson({ tool: writer.flags.json });
        return writer.flags.json;
      });

      const jsonMode = await Effect.runPromise(program);
      expect(jsonMode).toBe(true);
      expect(stdout.data).toHaveLength(1);
      expect(JSON.parse(stdout.data[0]!)).toEqual({
        tool: "kimi-test",
        schemaVersion: 1,
      });
      expect(stderr.data).toHaveLength(0);
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  test("createCliEffect surfaces parse failures as EffectCliContractError", async () => {
    const program = createCliEffect(["bun", "kimi-test", "--bad-flag"], "kimi-test", {
      strict: true,
    });
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toBeInstanceOf(EffectCliContractError);
    }
  });
});
