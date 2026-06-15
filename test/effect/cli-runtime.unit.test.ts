import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { runCli, runCliExit } from "../../src/lib/effect/cli-runtime.ts";
import { CliError } from "../../src/lib/effect/errors.ts";

describe("cli-runtime", () => {
  test("runCli returns 0 on success", async () => {
    const code = await runCli(Effect.succeed(undefined), { toolName: "test-cli" });
    expect(code).toBe(0);
  });

  test("runCli maps CliError to exitCode", async () => {
    const code = await runCli(
      Effect.fail(new CliError({ message: "expected failure", exitCode: 2 })),
      { toolName: "test-cli" }
    );
    expect(code).toBe(2);
  });

  test("runCli returns 1 for generic Effect failure", async () => {
    const code = await runCli(Effect.fail(new Error("unexpected")), { toolName: "test-cli" });
    expect(code).toBe(1);
  });

  test("runCliExit returns program exit code on success", async () => {
    const code = await runCliExit(Effect.succeed(42), { toolName: "test-cli" });
    expect(code).toBe(42);
  });

  test("runCliExit maps CliError to exitCode", async () => {
    const code = await runCliExit(
      Effect.fail(new CliError({ message: "exit failure", exitCode: 3 })),
      { toolName: "test-cli" }
    );
    expect(code).toBe(3);
  });
});
