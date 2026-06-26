/**
 * Ported from oven-sh/bun test/cli/bunfig-test-options.test.ts @ pinned commit.
 */

import { describe, expect, test } from "bun:test";
import { runBunfigTestOptionsProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { spawnCaptured, withTempDir, writeText } from "./helpers.ts";
import { join } from "path";

function extractOrder(output: string): string[] {
  return [...output.matchAll(/RUNNING: (\w+)/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

describe("bun-cli-bunfig-test-options contract probes", () => {
  test("runBunfigTestOptionsProbes all pass on current Bun", async () => {
    const failed = (await runBunfigTestOptionsProbes()).filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });
});

describe("bun-cli-bunfig-test-options", () => {
  test("seed without randomize errors", async () => {
    await withTempDir("bunfig-seed-", async (dir) => {
      writeText(
        join(dir, "test.test.ts"),
        `import { test, expect } from "bun:test"; test("t", () => expect(1).toBe(1));`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\nseed = 2444615283\n");
      const cap = await spawnCaptured([process.execPath, "test"], { cwd: dir });
      expect(cap.exitCode).toBe(1);
      expect(`${cap.stdout}${cap.stderr}`).toContain("randomize");
    });
  });

  test("rerunEach option works", async () => {
    await withTempDir("bunfig-rerun-", async (dir) => {
      writeText(
        join(dir, "test.test.ts"),
        `import { test, expect } from "bun:test"; let c=0; test("t", () => { c++; expect(c).toBeGreaterThan(0); });`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\nrerunEach = 3\n");
      const cap = await spawnCaptured([process.execPath, "test"], { cwd: dir });
      expect(cap.exitCode).toBe(0);
      expect(`${cap.stdout}${cap.stderr}`).toContain("3 pass");
    });
  });

  test("randomize with seed produces consistent order", async () => {
    await withTempDir("bunfig-rand-", async (dir) => {
      writeText(
        join(dir, "test.test.ts"),
        `import { test, expect } from "bun:test";
for (const n of ["alpha","bravo","charlie","delta","echo"]) {
  test(n, () => { console.log("RUNNING: " + n); expect(1).toBe(1); });
}`
      );
      writeText(join(dir, "bunfig.toml"), "[test]\nrandomize = true\nseed = 2444615283\n");
      const orders: string[][] = [];
      for (let i = 0; i < 2; i++) {
        const cap = await spawnCaptured([process.execPath, "test"], { cwd: dir });
        expect(cap.exitCode).toBe(0);
        orders.push(extractOrder(`${cap.stdout}${cap.stderr}`));
      }
      expect(orders[0]).toEqual(orders[1]);
      expect(orders[0]).not.toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
    });
  });
});
