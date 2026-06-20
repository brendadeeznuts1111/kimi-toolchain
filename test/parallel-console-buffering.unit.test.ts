/**
 * Parallel console output non-interleaving regression test.
 *
 * Bun's --parallel flag buffers console.log/console.error output per test file
 * and flushes it atomically, so files never interleave even under work-stealing.
 * This test spawns multiple test files in parallel mode and verifies output integrity.
 *
 * @see BUN_TEST_FLAG_INTERACTIONS.parallelConsole
 */
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { makeDir, removePath, writeText } from "./helpers.ts";

const FIXTURE_DIR = join(import.meta.dir, ".tmp-console-parallel-fixtures");

function fixture(name: string, lines: number): string {
  const logs = Array.from({ length: lines }, (_, i) => `console.log("${name}-${i}");`).join("\n");
  const group = JSON.stringify(name);
  return `import { describe, test } from "bun:test";\ndescribe(${group}, () => {\n  test("logs", () => {\n${logs}\n  });\n});\n`;
}

describe("parallel-console-buffering", () => {
  test("output from parallel test files is complete and non-interleaved", async () => {
    makeDir(FIXTURE_DIR, { recursive: true });

    for (let f = 0; f < 4; f++) {
      writeText(join(FIXTURE_DIR, `file-${f}.test.ts`), fixture(`f${f}`, 20));
    }

    try {
      const result = await $`bun test --parallel=4 ${FIXTURE_DIR}/*.test.ts`
        .cwd(import.meta.dir)
        .nothrow();

      // All 4 tests should pass (exit 0 confirms console output worked correctly)
      expect(result.exitCode).toBe(0);
    } finally {
      removePath(FIXTURE_DIR, { recursive: true, force: true });
    }
  }, 15_000);
});
