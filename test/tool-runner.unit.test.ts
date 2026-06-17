import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  invokeCommand,
  invokeTool,
  NO_TOOL_TIMEOUT_MS,
  resolveToolSpawnTimeoutMs,
  runTool,
  toolsDir,
} from "../src/lib/tool-runner.ts";

function tmpScript(content: string): string {
  const dir = testTempDir("kimi-tool-runner-");
  makeDir(dir, { recursive: true });
  const path = join(dir, "script.ts");
  writeText(path, content);
  return path;
}

describe("tool-runner", () => {
  test("toolsDir points under ~/.kimi-code/tools", () => {
    expect(toolsDir()).toContain(".kimi-code/tools");
  });

  test("runTool throws when tool file is missing", async () => {
    await expect(runTool("definitely-missing-tool-xyz", [])).rejects.toThrow("Tool not found");
  });

  test(
    "invokeTool captures stdout, stderr, and exit code",
    async () => {
      const script = tmpScript(`
      console.log("stdout-line");
      console.error("stderr-line");
      process.exit(2);
    `);
      const result = await invokeTool(script, []);
      expect(result.stdout).toContain("stdout-line");
      expect(result.stderr).toContain("stderr-line");
      expect(result.exitCode).toBe(2);
      expect(result.isError).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 3000 }
  );

  test(
    "invokeTool respects cwd",
    async () => {
      const cwd = testTempDir("kimi-tool-runner-cwd-");
      makeDir(cwd, { recursive: true });
      const script = tmpScript(`console.log(process.cwd());`);
      const result = await invokeTool(script, [], { cwd });
      expect(result.stdout).toContain(cwd);
      removePath(cwd, { recursive: true, force: true });
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 3000 }
  );

  test(
    "invokeTool applies env overlay",
    async () => {
      const script = tmpScript(`console.log(Bun.env.KIMI_TOOL_RUNNER_TEST_VALUE ?? "missing");`);
      const result = await invokeTool(script, [], {
        env: { KIMI_TOOL_RUNNER_TEST_VALUE: "from-env-overlay" },
      });
      expect(result.stdout).toContain("from-env-overlay");
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 3000 }
  );

  test(
    "invokeTool truncates retained stdout and stderr",
    async () => {
      const script = tmpScript(`
      console.log("stdout-" + "x".repeat(128));
      console.error("stderr-" + "y".repeat(128));
    `);
      const result = await invokeTool(script, [], { maxOutputBytes: 24 });
      expect(result.maxOutputBytes).toBe(24);
      expect(result.stdout.length).toBeLessThanOrEqual(24);
      expect(result.stderr.length).toBeLessThanOrEqual(24);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(true);
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 3000 }
  );

  test(
    "invokeCommand normalizes negative output limits to zero bytes",
    async () => {
      const result = await invokeCommand(["bun", "--version"], { maxOutputBytes: -1 });
      expect(result.maxOutputBytes).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    },
    { timeout: 3000 }
  );

  test(
    "invokeCommand returns a structured error when spawn fails",
    async () => {
      const missingCommand = testTempDir("missing-command-");
      const result = await invokeCommand([missingCommand], { timeoutMs: 1000 });
      expect(result.tool).toBe(missingCommand);
      expect(result.exitCode).toBe(-1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.error).toContain("Failed to spawn command");
      expect(result.isError).toBe(true);
    },
    { timeout: 3000 }
  );

  test(
    "invokeTool drains large output without blocking child exit",
    async () => {
      const script = tmpScript(`
      await Bun.write(Bun.stdout, "x".repeat(2_000_000));
      await Bun.write(Bun.stderr, "y".repeat(2_000_000));
    `);
      const result = await invokeTool(script, [], { maxOutputBytes: 64, timeoutMs: 5000 });
      expect(result.exitCode).toBe(0);
      expect(result.isError).toBe(false);
      expect(result.stdout.length).toBe(64);
      expect(result.stderr.length).toBe(64);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(true);
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 5000 }
  );

  test("resolveToolSpawnTimeoutMs disables timeout for watch and MCP server", () => {
    expect(resolveToolSpawnTimeoutMs(["--watch"])).toBe(NO_TOOL_TIMEOUT_MS);
    expect(resolveToolSpawnTimeoutMs(["--mcp-server"])).toBe(NO_TOOL_TIMEOUT_MS);
    expect(resolveToolSpawnTimeoutMs(["--watch-interval", "10"])).toBe(NO_TOOL_TIMEOUT_MS);
    expect(resolveToolSpawnTimeoutMs(["--effect-gates"])).toBeGreaterThan(0);
  });

  test(
    "invokeTool with NO_TOOL_TIMEOUT_MS does not kill a long-running child",
    async () => {
      const script = tmpScript(`await Bun.sleep(400);`);
      const result = await invokeTool(script, [], { timeoutMs: NO_TOOL_TIMEOUT_MS });
      expect(result.timedOut).toBeUndefined();
      expect(result.isError).toBe(false);
      expect(result.exitCode).toBe(0);
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 5000 }
  );

  test(
    "invokeTool reports timeout",
    async () => {
      const script = tmpScript(`setTimeout(() => {}, 60000);`);
      const result = await invokeTool(script, [], { timeoutMs: 100, gracePeriodMs: 50 });
      expect(result.isError).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.error).toContain("timed out");
      removePath(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 5000 }
  );

  test(
    "runTool resolves tool from ~/.kimi-code/tools",
    async () => {
      const tmpHome = testTempDir("kimi-tool-runner-home-");
      makeDir(tmpHome, { recursive: true });
      const toolsDirPath = join(tmpHome, ".kimi-code", "tools");
      makeDir(toolsDirPath, { recursive: true });
      writeText(
        join(toolsDirPath, "kimi-doctor.ts"),
        "#!/usr/bin/env bun\nconsole.log('mock-doctor-ok');\n"
      );

      const prevHome = Bun.env.HOME;
      Bun.env.HOME = tmpHome;
      try {
        const result = await runTool("kimi-doctor", [], { timeoutMs: 5000 });
        expect(result.stdout).toContain("mock-doctor-ok");
        expect(result.exitCode).toBe(0);
        expect(result.isError).toBe(false);
      } finally {
        Bun.env.HOME = prevHome;
        removePath(tmpHome, { recursive: true, force: true });
      }
    },
    { timeout: 3000 }
  );
});
