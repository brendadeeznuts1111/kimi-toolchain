import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import {
  buildWithMetafile,
  generateMarkdownSummary,
  runBundleGate,
} from "../src/lib/bundle-gate.ts";
import { cleanupPath, REPO_ROOT, testTempDir, withTempDir } from "./helpers.ts";

const FIXTURE_ENTRY = join(REPO_ROOT, "test/fixtures/bundle-gate-test-entry.ts");

describe.serial("bundle-gate-integration", () => {
  describe("bundle-gate-integration metafile", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = testTempDir("bundle-gate-int-");
    });

    afterEach(() => {
      cleanupPath(tempDir);
    });

    test("generates metafile for a simple entry", async () => {
      const result = await buildWithMetafile(FIXTURE_ENTRY, tempDir, {
        projectRoot: REPO_ROOT,
      });

      expect(result.metafile.outputs).toBeDefined();
      expect(Object.keys(result.metafile.outputs).length).toBeGreaterThan(0);
      expect(await Bun.file(result.metafilePath).exists()).toBe(true);

      const summary = generateMarkdownSummary(result.metafile);
      expect(summary).toContain("# Bundle Analysis Report");
      expect(summary).toContain("## Quick Summary");
    });

    test("handles missing entry gracefully", async () => {
      await expect(
        buildWithMetafile(join(tempDir, "non-existent.ts"), tempDir, {
          projectRoot: REPO_ROOT,
        })
      ).rejects.toThrow(/Entry point not found/);
    });
  });

  test("runBundleGate on default entry point succeeds", async () => {
    const report = await runBundleGate({ projectRoot: REPO_ROOT });
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("bundle-gate");
    expect(report.entryPoint).toBe("src/bin/kimi-doctor.ts");
    expect(report.summary).not.toBeNull();
    expect(report.summary!.totalBytes).toBeGreaterThan(0);
    expect(report.summary!.inputModules).toBeGreaterThan(0);
    expect(report.largestModules.length).toBeGreaterThan(0);
    expect(report.metafilePath).toBeTruthy();
    expect(report.markdownPath).toBeTruthy();
    expect(report.error).toBeNull();
  });

  test("runBundleGate on nonexistent entry point returns error", async () => {
    const report = await runBundleGate({
      projectRoot: REPO_ROOT,
      entryPoints: [{ path: "src/nonexistent.ts", target: "bun" }],
    });
    expect(report.ok).toBe(false);
    expect(report.summary).toBeNull();
    expect(report.findings.some((f) => f.rule === "no-entry-point")).toBe(true);
  });

  test("runBundleGate parses real typescript.js bloat", async () => {
    const report = await runBundleGate({ projectRoot: REPO_ROOT });
    const topModule = report.largestModules[0];
    if (topModule) {
      expect(topModule.module).toContain("typescript");
      expect(topModule.pctOfTotal).toBeGreaterThan(30);
    }
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("single-module-bloat");
    expect(rules).toContain("node-modules-bloat");
  });

  test("buildWithMetafile round-trip via withTempDir", async () => {
    await withTempDir("bundle-gate-wrap", async (dir) => {
      const result = await buildWithMetafile(FIXTURE_ENTRY, dir, { projectRoot: REPO_ROOT });
      expect(result.metafile.inputs).toBeDefined();
      expect(Object.keys(result.metafile.inputs).length).toBeGreaterThan(0);
    });
  });
});
