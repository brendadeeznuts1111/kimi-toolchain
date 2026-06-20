import { describe, expect, test } from "bun:test";
import { checkKimiDocsAligned, isKimiToolchainProject } from "../src/lib/kimi-docs-aligned.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("kimi-docs-aligned", () => {
  test("isKimiToolchainProject true for this repo", async () => {
    expect(await isKimiToolchainProject(REPO_ROOT)).toBe(true);
  });

  test(
    "checkKimiDocsAligned passes for toolchain docs",
    async () => {
      const report = await checkKimiDocsAligned(REPO_ROOT);
      expect(report.applicable).toBe(true);
      expect(report.aligned).toBe(true);
      expect(report.checks.every((c) => c.status === "ok")).toBe(true);
    },
    { timeout: 5000 }
  );

  test("skips non-toolchain projects", async () => {
    const report = await checkKimiDocsAligned(import.meta.dir);
    expect(report.applicable).toBe(false);
    expect(report.aligned).toBe(true);
    expect(report.checks).toHaveLength(0);
  });
});
