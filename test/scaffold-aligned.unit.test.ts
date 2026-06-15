import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { checkScaffoldAligned, hasKimiPreflight } from "../src/lib/scaffold-aligned.ts";
import { buildAgentsMd } from "../src/lib/scaffold-agents.ts";

let projectDir: string;

beforeEach(() => {
  projectDir = join(tmpdir(), `kimi-scaffold-align-${Bun.randomUUIDv7()}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

describe("scaffold-aligned", () => {
  test("hasKimiPreflight true when dx.config.toml has preflight", async () => {
    writeFileSync(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    expect(await hasKimiPreflight(projectDir)).toBe(true);
  });

  test("checkScaffoldAligned passes for scaffolded AGENTS.md", async () => {
    writeFileSync(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    writeFileSync(join(projectDir, "AGENTS.md"), buildAgentsMd("demo"));
    const report = await checkScaffoldAligned(projectDir);
    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
  });

  test("warns when scaffolded AGENTS.md has old DX bootstrap defaults", async () => {
    writeFileSync(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      buildAgentsMd("demo")
        .replace("dx setup`, ", "")
        .replace(", `dx cli`, and `dx package", ", and `dx mcp-doctor")
    );

    const report = await checkScaffoldAligned(projectDir);
    const agents = report.checks.find((check) => check.name === "AGENTS.md");

    expect(report.aligned).toBe(false);
    expect(agents?.status).toBe("warn");
    expect(agents?.message).toContain("dx setup");
    expect(agents?.message).toContain("dx cli");
  });

  test("skips projects without kimi preflight", async () => {
    const report = await checkScaffoldAligned(projectDir);
    expect(report.applicable).toBe(false);
  });
});
