import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { invokeTool, runTool, toolsDir } from "../src/lib/tool-runner.ts";

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

  test(
    "invokeTool reports timeout",
    async () => {
      const script = tmpScript(`setTimeout(() => {}, 60000);`);
      const result = await invokeTool(script, [], { timeoutMs: 100, gracePeriodMs: 50 });
      expect(result.isError).toBe(true);
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
