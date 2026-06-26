/**
 * Ported from oven-sh/bun test/cli/heap-prof.test.ts @ pinned commit.
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "path";
import { runHeapProfContractProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { spawnCaptured, withTempDir } from "./helpers.ts";

const SCRIPT = `const arr = []; for (let i = 0; i < 100; i++) arr.push({ x: i, y: "hello" + i }); console.log("done");`;

describe("bun-cli-heap-prof contract probes", () => {
  test("runHeapProfContractProbes all pass on current Bun", async () => {
    const failed = (await runHeapProfContractProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  }, 30_000);
});

describe("bun-cli-heap-prof", () => {
  test("--heap-prof-md generates markdown heap profile on exit", async () => {
    await withTempDir("heap-md-", async (dir) => {
      const cap = await spawnCaptured([process.execPath, "--heap-prof-md", "-e", SCRIPT], {
        cwd: dir,
      });
      expect(cap.exitCode).toBe(0);
      expect(cap.stdout.trim()).toBe("done");
      expect(cap.stderr).toContain("Heap profile written to:");
      const files = [...new Glob("Heap.*.md").scanSync({ cwd: dir })];
      expect(files.length).toBeGreaterThan(0);
      const content = await Bun.file(join(dir, files[0] ?? "")).text();
      expect(content).toContain("# Bun Heap Profile");
      expect(content).toContain("## Summary");
    });
  }, 15_000);
});
