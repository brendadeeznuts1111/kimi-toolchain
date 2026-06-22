import { describe, expect, spyOn, test } from "bun:test";
import {
  adaptiveCacheTTL,
  classifyPressure,
  forceGarbageCollection,
  isActuallyCritical,
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
});
