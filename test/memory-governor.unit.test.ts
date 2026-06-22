import { describe, expect, spyOn, test } from "bun:test";
import {
  adaptiveCacheTTL,
  classifyPressure,
  isActuallyCritical,
  preflightCheck,
  printMemoryTable,
  snapshot,
} from "../src/lib/memory/governor.ts";

describe("memory-governor", () => {
  test("snapshot combines process and system memory", () => {
    const snap = snapshot();
    expect(typeof snap.process.rss).toBe("number");
    expect(typeof snap.system.totalBytes).toBe("number");
    expect(snap.system.totalBytes).toBeGreaterThan(0);
    expect(snap.usedPercent).toBeGreaterThanOrEqual(0);
    expect(snap.usedPercent).toBeLessThanOrEqual(100);
  });

  test("classifyPressure buckets by used percent", () => {
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 0 })).toBe(
      "none"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 69 })).toBe(
      "none"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 70 })).toBe(
      "fair"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 84 })).toBe(
      "fair"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 85 })).toBe(
      "serious"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 95 })).toBe(
      "serious"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 95.1 })).toBe(
      "critical"
    );
    expect(classifyPressure({ process: {} as never, system: {} as never, usedPercent: 100 })).toBe(
      "critical"
    );
  });

  test("adaptiveCacheTTL reduces TTL under pressure", () => {
    expect(
      adaptiveCacheTTL(30_000, { process: {} as never, system: {} as never, usedPercent: 0 })
    ).toBe(30_000);
    expect(
      adaptiveCacheTTL(30_000, { process: {} as never, system: {} as never, usedPercent: 70 })
    ).toBe(15_000);
    expect(
      adaptiveCacheTTL(30_000, { process: {} as never, system: {} as never, usedPercent: 85 })
    ).toBe(3_000);
    expect(
      adaptiveCacheTTL(30_000, { process: {} as never, system: {} as never, usedPercent: 95.1 })
    ).toBe(0);
  });

  test("adaptiveCacheTTL floors at zero", () => {
    expect(
      adaptiveCacheTTL(0, { process: {} as never, system: {} as never, usedPercent: 100 })
    ).toBe(0);
  });

  test("isActuallyCritical respects platform and heap ratio", () => {
    const lowHeap = {
      process: { heapUsed: 1e8 },
      system: { usedBytes: 17e9 },
      usedPercent: 96,
    } as never;
    expect(isActuallyCritical(lowHeap)).toBe(false);

    const highHeap = {
      process: { heapUsed: 6e9 },
      system: { usedBytes: 17e9 },
      usedPercent: 96,
    } as never;
    expect(isActuallyCritical(highHeap)).toBe(true);
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
    expect(output).toContain("Pressure");
    expect(output).toContain("Actually Critical");
  });
});
