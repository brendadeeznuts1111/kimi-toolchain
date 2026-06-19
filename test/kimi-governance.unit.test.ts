import { makeDir, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it } from "bun:test";
import { join } from "path";
import { loadCachedCoverage } from "../src/lib/governance.ts";
import { governorDir } from "../src/lib/paths.ts";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";

describe("kimi-governance", () => {
  it("loadCachedCoverage reads the latest coverage-history entry", async () => {
    const projectDir = testTempDir("gov-score-");
    try {
      await withEnv({ HOME: projectDir }, async () => {
        makeDir(governorDir(), { recursive: true });
        makeDir(join(projectDir, "coverage"), { recursive: true });
        writeText(
          join(projectDir, "package.json"),
          JSON.stringify({ name: "demo-project", scripts: { test: "bun test" } })
        );
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
        expect(report).not.toBeNull();
        expect(report!.percentage).toBe(42.5);
        expect(report!.covered).toBe(85);
        expect(report!.total).toBe(200);
      });
    } finally {
      cleanupPath(projectDir);
    }
  });
});
