import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { loadCachedCoverage } from "../src/bin/kimi-governance.ts";
import { governorDir } from "../src/lib/paths.ts";

import { testTempDir } from "./helpers.ts";
describe("kimi-governance", () => {
  let projectDir: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = Bun.env.HOME;
    projectDir = testTempDir("gov-score-");
    Bun.env.HOME = projectDir;
    makeDir(governorDir(), { recursive: true });
    makeDir(join(projectDir, "coverage"), { recursive: true });
    writeText(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "demo-project", scripts: { test: "bun test" } })
    );
  });

  afterEach(() => {
    if (previousHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previousHome;
    removePath(projectDir, { recursive: true, force: true });
  });

  it("loadCachedCoverage reads the latest coverage-history entry", async () => {
    writeText(
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
