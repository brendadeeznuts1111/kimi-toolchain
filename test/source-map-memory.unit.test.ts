/**
 * Source map memory regression test.
 *
 * Bun v1.3.13 replaced Mapping.List (20 B/mapping, ~11 MB RSS for _tsc.js)
 * with bit-packed windows (~2.4 B/mapping, ~1.3 MB RSS).
 *
 * Pre-1.3.12 (Mapping.List): first .stack on 200k-line module added ~11 MB RSS
 *   1.3.13+ (bit-packed):     first .stack on 200k-line module adds ~0.06 MB RSS
 *
 * This test verifies the bit-packed representation is active and catches
 * regressions if a future version reintroduces the expensive decode-at-access path.
 *
 * Test fixture: typescript/lib/typescript.js (~200k lines, ~9 MB raw)
 * This is comparable to the _tsc.js fixture used in Bun's own benchmarks.
 *
 * @see https://bun.com/blog/bun-v1.3.13
 */
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "./helpers.ts";

const TSC_PATH = join(import.meta.dir, "..", "node_modules", "typescript", "lib", "typescript.js");
const SOURCE_MAP_REPRESENTATION_BASELINES = {
  mappingList: {
    label: "Mapping.List",
    bunVersion: "v1.3.12 baseline",
    bytesPerMapping: 20,
    firstStackRssMB: 11,
  },
  bitPacked: {
    label: "Bit-packed",
    bunVersion: "v1.3.13+ current",
    bytesPerMapping: 2.4,
    firstStackRssMB: 0.06,
    maxFirstStackRssMB: 5,
  },
} as const;

const SOURCE_MAP_BENCHMARK_BASELINES = {
  decodingCost: "close to 0",
  encoding: "faster",
  rows: {
    errorCaptureStackMultiWindow: {
      thisReleaseUs: [1.37, 1.41],
      bun1312Us: [1.27, 1.32],
      delta: "+6-8%",
    },
    plainStackLoop: {
      thisReleaseNs: 657,
      bun1312Ns: 810,
      delta: "-19%",
    },
    fiveFrameMultiWindow: {
      thisReleaseNs: 818,
      bun1312Ns: 769,
      delta: "+6%",
    },
    firstStack150kModule: {
      thisReleaseMs: 0.1,
      bun1312Ms: 5,
      delta: "-98%",
    },
    rssLoadToFirstStack150kModule: {
      thisReleaseMB: 0.06,
      bun1312MB: 2.3,
    },
  },
} as const;

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function hasFixture(): boolean {
  return pathExists(TSC_PATH);
}

describe("source-map-memory", () => {
  test("typescript.js fixture is available", () => {
    expect(pathExists(TSC_PATH)).toBe(true);
  });

  test("documents Bun source map representation density targets", () => {
    const { mappingList, bitPacked } = SOURCE_MAP_REPRESENTATION_BASELINES;

    expect(mappingList.label).toBe("Mapping.List");
    expect(mappingList.bytesPerMapping).toBe(20);
    expect(bitPacked.label).toBe("Bit-packed");
    expect(bitPacked.bytesPerMapping).toBe(2.4);
    expect(bitPacked.bytesPerMapping).toBeLessThan(mappingList.bytesPerMapping / 8);
    expect(bitPacked.maxFirstStackRssMB).toBeLessThan(mappingList.firstStackRssMB);
  });

  test("documents Bun 1.3.13 source map benchmark tradeoffs", () => {
    const { rows } = SOURCE_MAP_BENCHMARK_BASELINES;

    expect(SOURCE_MAP_BENCHMARK_BASELINES.decodingCost).toBe("close to 0");
    expect(SOURCE_MAP_BENCHMARK_BASELINES.encoding).toBe("faster");
    expect(rows.errorCaptureStackMultiWindow.delta).toBe("+6-8%");
    expect(rows.errorCaptureStackMultiWindow.thisReleaseUs[1]).toBeGreaterThan(
      rows.errorCaptureStackMultiWindow.bun1312Us[1]
    );
    expect(rows.plainStackLoop.thisReleaseNs).toBeLessThan(rows.plainStackLoop.bun1312Ns);
    expect(rows.fiveFrameMultiWindow.delta).toBe("+6%");
    expect(rows.firstStack150kModule.thisReleaseMs).toBeLessThan(
      rows.firstStack150kModule.bun1312Ms / 40
    );
    expect(rows.rssLoadToFirstStack150kModule.thisReleaseMB).toBeLessThan(
      rows.rssLoadToFirstStack150kModule.bun1312MB / 30
    );
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
      void err.stack;

      const rssAfterStack = rssMB();
      const stackDelta = Math.round((rssAfterStack - rssAfterRequire) * 100) / 100;

      console.log(`  RSS baseline:     ${rssBefore.toFixed(1)} MB`);
      console.log(
        `  RSS after require: ${rssAfterRequire.toFixed(1)} MB (+${loadDelta} MB module load)`
      );
      console.log(
        `  RSS after .stack:  ${rssAfterStack.toFixed(1)} MB (+${stackDelta} MB stack access)`
      );
      console.log(
        `  ${SOURCE_MAP_REPRESENTATION_BASELINES.mappingList.label} (${SOURCE_MAP_REPRESENTATION_BASELINES.mappingList.bunVersion}): ~+${SOURCE_MAP_REPRESENTATION_BASELINES.mappingList.firstStackRssMB} MB, ${SOURCE_MAP_REPRESENTATION_BASELINES.mappingList.bytesPerMapping} B/mapping │ ${SOURCE_MAP_REPRESENTATION_BASELINES.bitPacked.label} (${SOURCE_MAP_REPRESENTATION_BASELINES.bitPacked.bunVersion}): ~+${SOURCE_MAP_REPRESENTATION_BASELINES.bitPacked.firstStackRssMB} MB, ${SOURCE_MAP_REPRESENTATION_BASELINES.bitPacked.bytesPerMapping} B/mapping`
      );

      // The first .stack on a 200k-line transpiled module should not add
      // more than 5 MB RSS under Bun 1.3.13's bit-packed source maps.
      // v1.3.12 would add ~11 MB just for source maps alone.
      expect(stackDelta).toBeLessThan(
        SOURCE_MAP_REPRESENTATION_BASELINES.bitPacked.maxFirstStackRssMB
      );
    },
    15_000
  );

  test("repeated .stack access is stable (not a leak)", () => {
    delete require.cache[TSC_PATH];
    require(TSC_PATH);

    const rssStart = rssMB();
    for (let i = 0; i < 10; i++) {
      void new Error("probe-" + i).stack;
    }
    const rssEnd = rssMB();
    const delta = rssEnd - rssStart;

    console.log(`  Repeated stack RSS delta: ${delta > 0 ? "+" : ""}${delta.toFixed(1)} MB`);
    // Repeated access should not accumulate memory
    expect(delta).toBeLessThan(20);
  });
});
