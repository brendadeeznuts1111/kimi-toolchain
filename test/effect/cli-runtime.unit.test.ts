import { pathExists, readText } from "../../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import { runCli, runCliExit } from "../../src/lib/effect/cli-runtime.ts";
import { CliError } from "../../src/lib/effect/errors.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { withTelemetryHome } from "../helpers.ts";

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

  test("runCliExit flushes passed logger when telemetry enabled", async () => {
    await withTelemetryHome(async (home) => {
      const logger = createLogger([], "test-cli");
      logger.info("telemetry flush test");

      const code = await runCliExit(Effect.succeed(0), { toolName: "test-cli", logger });
      expect(code).toBe(0);

      const path = join(home, ".kimi-code", "var", "cli-telemetry.jsonl");
      expect(pathExists(path)).toBe(true);
      const lines = readText(path).trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      const entry = JSON.parse(lines[lines.length - 1]!);
      expect(entry.message).toBe("telemetry flush test");
      expect(entry.tool).toBe("test-cli");
    });
  });

  test("runCliExit flushes passed logger on non-zero exit code", async () => {
    await withTelemetryHome(async (home) => {
      const logger = createLogger([], "test-cli");
      logger.warn("doctor-style warning");

      const code = await runCliExit(Effect.succeed(1), { toolName: "test-cli", logger });
      expect(code).toBe(1);

      const path = join(home, ".kimi-code", "var", "cli-telemetry.jsonl");
      expect(readText(path)).toContain("doctor-style warning");
    });
  });

  test("runCliExit flushes telemetry when the Effect fails", async () => {
    await withTelemetryHome(async (home) => {
      const logger = createLogger([], "test-cli");
      logger.warn("pre-failure telemetry");

      const code = await runCliExit(Effect.fail(new Error("effect failed")), {
        toolName: "test-cli",
        logger,
      });
      expect(code).toBe(1);

      const path = join(home, ".kimi-code", "var", "cli-telemetry.jsonl");
      const content = readText(path);
      expect(content).toContain("pre-failure telemetry");
      expect(content).toContain("effect failed");
    });
  });
});
