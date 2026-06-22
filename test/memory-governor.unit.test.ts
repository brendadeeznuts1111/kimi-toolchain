import { describe, expect, spyOn, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir } from "./helpers.ts";
import {
  adaptiveCacheTTL,
  captureMimallocStats,
  classifyPressure,
  forceGarbageCollection,
  isActuallyCritical,
  parseMimallocStats,
  preflightCheck,
  printMemoryTable,
  snapshot,
} from "../src/lib/memory/governor.ts";

function emptySnap(usedPercent: number) {
  return { process: {} as never, jscHeap: {} as never, system: {} as never, usedPercent };
}

describe("memory-governor", () => {
  test("snapshot combines process, jsc heap, and system memory", () => {
    const snap = snapshot();
    expect(typeof snap.process.rss).toBe("number");
    expect(typeof snap.jscHeap.heapSize).toBe("number");
    expect(typeof snap.jscHeap.objectCount).toBe("number");
    expect(typeof snap.system.totalBytes).toBe("number");
    expect(snap.system.totalBytes).toBeGreaterThan(0);
    expect(snap.usedPercent).toBeGreaterThanOrEqual(0);
    expect(snap.usedPercent).toBeLessThanOrEqual(100);
  });

  test("classifyPressure buckets by used percent", () => {
    expect(classifyPressure(emptySnap(0))).toBe("none");
    expect(classifyPressure(emptySnap(69))).toBe("none");
    expect(classifyPressure(emptySnap(70))).toBe("fair");
    expect(classifyPressure(emptySnap(84))).toBe("fair");
    expect(classifyPressure(emptySnap(85))).toBe("serious");
    expect(classifyPressure(emptySnap(95))).toBe("serious");
    expect(classifyPressure(emptySnap(95.1))).toBe("critical");
    expect(classifyPressure(emptySnap(100))).toBe("critical");
  });

  test("adaptiveCacheTTL reduces TTL under pressure", () => {
    expect(adaptiveCacheTTL(30_000, emptySnap(0))).toBe(30_000);
    expect(adaptiveCacheTTL(30_000, emptySnap(70))).toBe(15_000);
    expect(adaptiveCacheTTL(30_000, emptySnap(85))).toBe(3_000);
    expect(adaptiveCacheTTL(30_000, emptySnap(95.1))).toBe(0);
  });

  test("adaptiveCacheTTL floors at zero", () => {
    expect(adaptiveCacheTTL(0, emptySnap(100))).toBe(0);
  });

  test("isActuallyCritical respects platform and heap ratio", () => {
    const lowHeap = {
      process: { heapUsed: 1e8 },
      jscHeap: {} as never,
      system: { usedBytes: 17e9 },
      usedPercent: 96,
    } as never;
    expect(isActuallyCritical(lowHeap)).toBe(false);

    const highHeap = {
      process: { heapUsed: 6e9 },
      jscHeap: {} as never,
      system: { usedBytes: 17e9 },
      usedPercent: 96,
    } as never;
    expect(isActuallyCritical(highHeap)).toBe(true);
  });

  test("forceGarbageCollection does not throw", () => {
    expect(() => forceGarbageCollection()).not.toThrow();
  });

  test("preflightCheck returns ok unless actually critical", () => {
    const ok = preflightCheck("test-op");
    expect(typeof ok.ok).toBe("boolean");
    expect(typeof ok.pressure).toBe("string");
    expect(ok.message).toContain("test-op");
  });

  test("printMemoryTable writes a table", () => {
    let output = "";
    using spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output += args.join(" ") + "\n";
    });
    printMemoryTable();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(output).toContain("RSS");
    expect(output).toContain("JSC Heap Size");
    expect(output).toContain("Pressure");
    expect(output).toContain("Actually Critical");
  });

  test("captureMimallocStats runs a script with MIMALLOC_SHOW_STATS=1", async () => {
    const dir = testTempDir("memory-governor-mimalloc-");
    const script = join(dir, "main.ts");
    await Bun.write(script, "console.log('ok');");
    try {
      const { combined, stderr, stdout, exitCode } = await captureMimallocStats(script, {
        timeout: 10_000,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ok");
      // Mimalloc stats may not be available on all platforms/builds.
      // When present, the combined output contains the stats block.
      if (stderr.length > 0 || combined.includes("heap stats:")) {
        expect(combined).toContain("heap stats:");
        expect(combined).toContain("rss:");
      }
    } finally {
      cleanupPath(dir);
    }
  });

  test("parseMimallocStats extracts the stats block", () => {
    const fixture = `heap stats:    peak      total      freed    current       unit      count
  reserved:   64.0 MiB   64.0 MiB      0       64.0 MiB                        not all freed!
 committed:   64.0 MiB   64.0 MiB      0       64.0 MiB                        not all freed!
     reset:      0          0          0          0                            ok
   touched:  128.5 KiB  128.5 KiB    5.4 MiB   -5.3 MiB                        ok
  segments:      1          1          0          1                            not all freed!
-abandoned:      0          0          0          0                            ok
   -cached:      0          0          0          0                            ok
     pages:      0          0         53        -53                            ok
-abandoned:      0          0          0          0                            ok
 -extended:      0
 -noretire:      0
     mmaps:      0
   commits:      0
   threads:      0          0          0          0                            ok
  searches:     0.0 avg
numa nodes:       1
   elapsed:       0.068 s
   process: user: 0.061 s, system: 0.014 s, faults: 0, rss: 57.4 MiB, commit: 64.0 MiB`;
    const stats = parseMimallocStats(fixture);
    expect(stats).toBeDefined();
    expect(stats?.reserved.peak).toBe(64 * 1024 ** 2);
    expect(stats?.committed.total).toBe(64 * 1024 ** 2);
    expect(stats?.touched.freed).toBe(5.4 * 1024 ** 2);
    expect(stats?.elapsedSeconds).toBe(0.068);
    expect(stats?.process.rssBytes).toBe(57.4 * 1024 ** 2);
    expect(stats?.process.faults).toBe(0);
  });

  test("parseMimallocStats returns undefined for unrelated text", () => {
    expect(parseMimallocStats("")).toBeUndefined();
    expect(parseMimallocStats("some log line\nanother line")).toBeUndefined();
  });
});
