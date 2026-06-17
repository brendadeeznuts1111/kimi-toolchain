import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadCachedCoverage } from "../src/bin/kimi-governance.ts";
import { governorDir } from "../src/lib/paths.ts";

describe("kimi-governance", () => {
  let projectDir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    projectDir = join(tmpdir(), `gov-score-${Date.now()}`);
    process.env.HOME = projectDir;
    mkdirSync(governorDir(), { recursive: true });
    mkdirSync(join(projectDir, "coverage"), { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "demo-project", scripts: { test: "bun test" } })
    );
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("loadCachedCoverage reads the latest coverage-history entry", async () => {
    writeFileSync(
      join(governorDir(), "coverage-history.json"),
      JSON.stringify([
        {
          project: "other",
          timestamp: "2026-01-01T00:00:00.000Z",
          percentage: 10,
          covered: 1,
          total: 10,
        },
        {
          project: "demo-project",
          timestamp: "2026-06-17T00:00:00.000Z",
          percentage: 42.5,
          covered: 85,
          total: 200,
        },
      ])
    );

    const report = await loadCachedCoverage(projectDir);
    expect(report.percentage).toBe(42.5);
    expect(report.covered).toBe(85);
    expect(report.total).toBe(200);
  });
});
