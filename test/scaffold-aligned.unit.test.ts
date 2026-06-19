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

  test("skips projects without kimi preflight", async () => {
    const report = await checkScaffoldAligned(projectDir);
    expect(report.applicable).toBe(false);
  });
});
