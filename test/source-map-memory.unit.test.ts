/**
 * Source map memory regression test.
 *
 * Bun v1.3.13 replaced Mapping.List (20 B/mapping, ~11 MB RSS) with bit-packed
 * windows (~2.4 B/mapping, ~1.3 MB RSS). The first .stack on a large transpiled
 * module should not materially increase resident set size.
 *
 * Test fixture: typescript/lib/typescript.js (~200k lines, ~9 MB raw)
 * This is comparable to the _tsc.js fixture used in Bun's own benchmarks.
 *
 * @see https://bun.com/blog/bun-v1.3.13
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

const TSC_PATH = join(import.meta.dir, "..", "node_modules", "typescript", "lib", "typescript.js");

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function hasFixture(): boolean {
  return existsSync(TSC_PATH);
}

describe("source-map-memory", () => {
  test("typescript.js fixture is available", () => {
    expect(existsSync(TSC_PATH)).toBe(true);
  });

  test.skipIf(!hasFixture())(
    "first .stack on large transpiled module does not materially increase RSS",
    async () => {
      // Clear module cache to ensure fresh require
      delete require.cache[TSC_PATH];
      for (const key of Object.keys(require.cache)) {
        if (key.includes("typescript")) delete require.cache[key];
      }

      if (globalThis.gc) globalThis.gc();
      await Bun.sleep(100);

      const rssBefore = rssMB();

      // Load the module — this is the bulk of the RSS increase (parsing, bytecode, etc.)
      require(TSC_PATH);

      const rssAfterRequire = rssMB();
      const loadDelta = Math.round((rssAfterRequire - rssBefore) * 100) / 100;

      // Access .stack — this is where Bun materializes source map representations.
      // Pre-1.3.13: full Mapping.List decoded into memory (~11 MB)
      // 1.3.13: bit-packed windows read in-place (~0.06 MB)
      const err = new Error("source-map-memory-test-probe");
      const _stack = err.stack;

      const rssAfterStack = rssMB();
      const stackDelta = Math.round((rssAfterStack - rssAfterRequire) * 100) / 100;

      console.log(`  RSS baseline:     ${rssBefore.toFixed(1)} MB`);
      console.log(`  RSS after require: ${rssAfterRequire.toFixed(1)} MB (+${loadDelta} MB module load)`);
      console.log(`  RSS after .stack:  ${rssAfterStack.toFixed(1)} MB (+${stackDelta} MB stack access)`);

      // The first .stack on a 200k-line transpiled module should not add
      // more than 5 MB RSS under Bun 1.3.13's bit-packed source maps.
      // v1.3.12 would add ~11 MB just for source maps alone.
      expect(stackDelta).toBeLessThan(5);
    },
    15_000
  );

  test("repeated .stack access is stable (not a leak)", () => {
    delete require.cache[TSC_PATH];
    require(TSC_PATH);

    const rssStart = rssMB();
    for (let i = 0; i < 10; i++) {
      const _s = new Error("probe-" + i).stack;
    }
    const rssEnd = rssMB();
    const delta = rssEnd - rssStart;

    console.log(`  Repeated stack RSS delta: ${delta > 0 ? "+" : ""}${delta.toFixed(1)} MB`);
    // Repeated access should not accumulate memory
    expect(delta).toBeLessThan(20);
  });
});
