import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { checkScaffoldAligned, hasKimiPreflight } from "../src/lib/scaffold-aligned.ts";
import { buildAgentsMd } from "../src/lib/scaffold-agents.ts";

import { testTempDir } from "./helpers.ts";
let projectDir: string;

beforeEach(() => {
  projectDir = testTempDir("kimi-scaffold-align-");
  makeDir(projectDir, { recursive: true });
});

afterEach(() => {
  if (pathExists(projectDir)) removePath(projectDir, { recursive: true, force: true });
});

describe("scaffold-aligned", () => {
  test("hasKimiPreflight true when dx.config.toml has preflight", async () => {
    writeText(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    expect(await hasKimiPreflight(projectDir)).toBe(true);
  });

  test("checkScaffoldAligned passes for scaffolded AGENTS.md", async () => {
    const home = join(projectDir, "home");
    writeText(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    writeText(join(projectDir, "AGENTS.md"), buildAgentsMd("demo", home));
    const report = await checkScaffoldAligned(projectDir);
    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(true);
  });

  test("warns when scaffolded AGENTS.md has old DX bootstrap defaults", async () => {
    const home = join(projectDir, "home");
    writeText(join(projectDir, "dx.config.toml"), "[kimi]\npreflight = true\n");
    writeText(
      join(projectDir, "AGENTS.md"),
      buildAgentsMd("demo", home)
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
