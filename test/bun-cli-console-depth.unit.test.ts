/**
 * Ported from oven-sh/bun test/cli/console-depth.test.ts @ pinned commit.
 *
 * @see https://github.com/oven-sh/bun/blob/1bd44dbe60ff766faadb41e71a8ca67de4c72a6f/test/cli/console-depth.test.ts
 */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  normalizeConsoleOutput,
  runConsoleDepthContractProbes,
} from "../src/lib/bun-cli-contract-probes.ts";
import { spawnCaptured, withTempDir, writeText } from "./helpers.ts";

const DEEP_OBJECT = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            level6: {
              level7: {
                level8: {
                  level9: {
                    level10: "deep value",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const TEST_SCRIPT = `console.log(${JSON.stringify(DEEP_OBJECT)});`;

describe("bun-cli-console-depth contract probes", () => {
  test("runConsoleDepthContractProbes all pass on current Bun", async () => {
    const results = await runConsoleDepthContractProbes();
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
  });
});

describe("bun-cli-console-depth", () => {
  test("default console depth should be 2", async () => {
    await withTempDir("console-depth-default-", async (dir) => {
      writeText(join(dir, "test.js"), TEST_SCRIPT);
      const cap = await spawnCaptured([process.execPath, "test.js"], { cwd: dir });
      expect(cap.exitCode).toBe(0);
      expect(cap.stderr).toBe("");
      expect(normalizeConsoleOutput(cap.stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}"
`);
    });
  });

  test("CLI flag overrides bunfig.toml", async () => {
    await withTempDir("console-depth-override-", async (dir) => {
      writeText(join(dir, "test.js"), TEST_SCRIPT);
      writeText(join(dir, "bunfig.toml"), "[console]\ndepth = 6\n");
      const cap = await spawnCaptured([process.execPath, "--console-depth", "2", "test.js"], {
        cwd: dir,
      });
      expect(cap.exitCode).toBe(0);
      expect(normalizeConsoleOutput(cap.stdout)).toMatchInlineSnapshot(`
"{
  level1: {
    level2: {
      level3: [Object ...],
    },
  },
}"
`);
    });
  });

  test("edge case: depth 0 should show infinite depth", async () => {
    await withTempDir("console-depth-zero-", async (dir) => {
      writeText(join(dir, "test.js"), TEST_SCRIPT);
      const cap = await spawnCaptured([process.execPath, "--console-depth", "0", "test.js"], {
        cwd: dir,
      });
      expect(cap.exitCode).toBe(0);
      expect(normalizeConsoleOutput(cap.stdout)).toContain('level10: "deep value"');
    });
  });
});
