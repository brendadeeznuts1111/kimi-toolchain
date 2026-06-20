import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { Effect } from "effect";
import { runCli, runCliExit } from "../../src/lib/effect/cli-runtime.ts";
import { CliError } from "../../src/lib/effect/errors.ts";
import { makeDir, pathExists, readText, removePath } from "../../src/lib/bun-io.ts";
import { createLogger } from "../../src/lib/logger.ts";

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
    const tmpHome = join(tmpdir(), `cli-runtime-telemetry-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
    const prevHome = Bun.env.HOME;
    const prevTelemetry = Bun.env.KIMI_TOOLCHAIN_TELEMETRY;
    Bun.env.HOME = tmpHome;
    Bun.env.KIMI_TOOLCHAIN_TELEMETRY = "true";

    const logger = createLogger([], "test-cli");
    logger.info("telemetry flush test");

    try {
      const code = await runCliExit(Effect.succeed(0), { toolName: "test-cli", logger });
      expect(code).toBe(0);

      const path = join(tmpHome, ".kimi-code", "var", "cli-telemetry.jsonl");
      expect(pathExists(path)).toBe(true);
      const lines = readText(path).trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      const entry = JSON.parse(lines[lines.length - 1]);
      expect(entry.message).toBe("telemetry flush test");
      expect(entry.tool).toBe("test-cli");
    } finally {
      Bun.env.HOME = prevHome;
      Bun.env.KIMI_TOOLCHAIN_TELEMETRY = prevTelemetry;
      removePath(tmpHome, { recursive: true, force: true });
    }
  });

  test("runCliExit flushes passed logger on non-zero exit code", async () => {
    const tmpHome = join(tmpdir(), `cli-runtime-telemetry-exit-${Bun.randomUUIDv7()}`);
    makeDir(tmpHome, { recursive: true });
    const prevHome = Bun.env.HOME;
    const prevTelemetry = Bun.env.KIMI_TOOLCHAIN_TELEMETRY;
    Bun.env.HOME = tmpHome;
    Bun.env.KIMI_TOOLCHAIN_TELEMETRY = "true";

    const logger = createLogger([], "test-cli");
    logger.warn("doctor-style warning");

    try {
      const code = await runCliExit(Effect.succeed(1), { toolName: "test-cli", logger });
      expect(code).toBe(1);

      const path = join(tmpHome, ".kimi-code", "var", "cli-telemetry.jsonl");
      const content = readText(path);
      expect(content).toContain("doctor-style warning");
    } finally {
      Bun.env.HOME = prevHome;
      Bun.env.KIMI_TOOLCHAIN_TELEMETRY = prevTelemetry;
      removePath(tmpHome, { recursive: true, force: true });
    }
  });
});
