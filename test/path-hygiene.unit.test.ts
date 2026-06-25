import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  collectPathHygieneItems,
  auditPathHygiene,
  applyPathHygieneCleanup,
} from "../src/lib/path-hygiene.ts";
import { withTempDir } from "./helpers.ts";

describe("path-hygiene", () => {
  test("collectPathHygieneItems finds literal tilde directories", () => {
    withTempDir("path-hygiene-tilde-", (dir) => {
      makeDir(join(dir, "~", ".bun", "install"), { recursive: true });
      writeText(join(dir, "~", ".bun", "install", "x"), "1");
      const items = collectPathHygieneItems({ scanRoot: dir, maxDepth: 3 });
      const tilde = items.find((i) => i.kind === "literal-tilde-dir");
      expect(tilde?.fileCount).toBe(1);
    });
  });

  test("collectPathHygieneItems finds literal $HOME directories", () => {
    withTempDir("path-hygiene-dollar-", (dir) => {
      makeDir(join(dir, "$HOME", ".bun"), { recursive: true });
      writeText(join(dir, "$HOME", "cache"), "x");
      const items = collectPathHygieneItems({ scanRoot: dir, maxDepth: 3 });
      const hit = items.find((i) => i.kind === "literal-dollar-home-dir");
      expect(hit?.fileCount).toBe(1);
    });
  });

  test("collectPathHygieneItems finds test-bun artifacts", () => {
    withTempDir("path-hygiene-bun-", (dir) => {
      makeDir(join(dir, "app", "test-bun-build"), { recursive: true });
      writeText(join(dir, "app", "test-bun-build", "out"), "bin");
      const items = collectPathHygieneItems({ scanRoot: dir, maxDepth: 3 });
      const hit = items.find((i) => i.kind === "test-bun-artifact");
      expect(hit?.relPath).toContain("test-bun-build");
      expect(hit?.fileCount).toBe(1);
    });
  });

  test("applyPathHygieneCleanup removes items when not dry-run", async () => {
    await withTempDir("path-hygiene-apply-", async (dir) => {
      const junk = join(dir, "test-bun-demo");
      makeDir(junk, { recursive: true });
      writeText(join(junk, "artifact"), "x");
      const report = await auditPathHygiene(dir, { dryRun: false, maxDepth: 2 });
      expect(report.items.length).toBe(1);
      const removed = await applyPathHygieneCleanup(report);
      expect(removed).toBe(1);
      const again = collectPathHygieneItems({ scanRoot: dir, maxDepth: 2 });
      expect(again).toHaveLength(0);
    });
  });

  test("dry-run does not delete", async () => {
    await withTempDir("path-hygiene-dry-", async (dir) => {
      makeDir(join(dir, "test-bun-keep"), { recursive: true });
      const report = await auditPathHygiene(dir, { dryRun: true, maxDepth: 2 });
      await applyPathHygieneCleanup(report);
      const items = collectPathHygieneItems({ scanRoot: dir, maxDepth: 2 });
      expect(items).toHaveLength(1);
    });
  });
});
