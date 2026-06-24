import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  invokeCommand,
  invokeTool,
  NO_TOOL_TIMEOUT_MS,
  resolveToolSpawnTimeoutMs,
  runTool,
  spawnBun,
  toolsDir,
  withBunNoOrphans,
} from "../src/lib/tool-runner.ts";
import { probeBunExecutable } from "../src/lib/root-hygiene.ts";

function tmpScript(content: string): string {
  const dir = join(tmpdir(), `kimi-tool-runner-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "script.ts");
  writeFileSync(path, content);
  return path;
}

describe("tool-runner", () => {
  test("toolsDir points under ~/.kimi-code/tools", () => {
    expect(toolsDir()).toContain(".kimi-code/tools");
  });

  test("withBunNoOrphans prepends flag once for bun commands", () => {
    const bun = probeBunExecutable();
    expect(withBunNoOrphans(["bun", "test"])).toEqual([bun, "--no-orphans", "test"]);
    expect(withBunNoOrphans(["bun", "--no-orphans", "run", "x.ts"])).toEqual([
      bun,
      "--no-orphans",
      "run",
      "x.ts",
    ]);
    expect(withBunNoOrphans([process.execPath, "dashboard"])).toEqual([
      process.execPath,
      "--no-orphans",
      "dashboard",
    ]);
    expect(withBunNoOrphans(["node", "script.js"])).toEqual(["node", "script.js"]);
  });

  test(
    "spawnBun runs bun with --no-orphans via invokeCommand",
    async () => {
      const result = await spawnBun(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expect(result.isError).toBe(false);
    },
    { timeout: 3000 }
  );

  test("runTool throws when tool file is missing", async () => {
    await expect(runTool("definitely-missing-tool-xyz", [])).rejects.toThrow("Tool not found");
  });

  test("invokeTool captures stdout, stderr, and exit code", async () => {
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
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test("invokeTool respects cwd", async () => {
    const cwd = join(tmpdir(), `kimi-tool-runner-cwd-${Bun.randomUUIDv7()}`);
    mkdirSync(cwd, { recursive: true });
    const script = tmpScript(`console.log(process.cwd());`);
    const result = await invokeTool(script, [], { cwd });
    expect(result.stdout).toContain(cwd);
    rmSync(cwd, { recursive: true, force: true });
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test("invokeTool applies env overlay", async () => {
    const script = tmpScript(`console.log(Bun.env.KIMI_TOOL_RUNNER_TEST_VALUE ?? "missing");`);
    const result = await invokeTool(script, [], {
      env: { KIMI_TOOL_RUNNER_TEST_VALUE: "from-env-overlay" },
    });
    expect(result.stdout).toContain("from-env-overlay");
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test("invokeTool scrubs Git hook-local env by default", async () => {
    const script = tmpScript(`console.log(Bun.env.GIT_DIR ?? "missing");`);
    const previousGitDir = Bun.env.GIT_DIR;
    Bun.env.GIT_DIR = "/tmp/parent-hook-git-dir";
    try {
      const result = await invokeTool(script, []);
      expect(result.stdout.trim()).toBe("missing");
    } finally {
      if (previousGitDir === undefined) delete Bun.env.GIT_DIR;
      else Bun.env.GIT_DIR = previousGitDir;
      rmSync(join(script, ".."), { recursive: true, force: true });
    }
  });

  test("invokeTool allows explicit Git env overlay", async () => {
    const script = tmpScript(`console.log(Bun.env.GIT_DIR ?? "missing");`);
    const result = await invokeTool(script, [], {
      env: { GIT_DIR: "/tmp/explicit-git-dir" },
    });
    expect(result.stdout.trim()).toBe("/tmp/explicit-git-dir");
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

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
      const missingCommand = join(tmpdir(), `missing-command-${Bun.randomUUIDv7()}`);
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

  test("invokeTool truncates retained stdout and stderr", async () => {
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
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

  test("invokeTool drains large output without blocking child exit", async () => {
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
    rmSync(join(script, ".."), { recursive: true, force: true });
  });

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
      rmSync(join(script, ".."), { recursive: true, force: true });
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
      rmSync(join(script, ".."), { recursive: true, force: true });
    },
    { timeout: 5000 }
  );

  test("runTool resolves tool from ~/.kimi-code/tools", async () => {
    const tmpHome = join(tmpdir(), `kimi-tool-runner-home-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpHome, { recursive: true });
    const toolsDirPath = join(tmpHome, ".kimi-code", "tools");
    mkdirSync(toolsDirPath, { recursive: true });
    writeFileSync(
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
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
