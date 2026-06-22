import { describe, expect, test } from "bun:test";
import {
  formatMemoryBytes,
  formatProcessMemoryUsage,
  processMemoryUsage,
} from "../src/lib/bun-utils.ts";

describe("bun-utils-memory", () => {
  test("processMemoryUsage returns non-negative memory fields", () => {
    const mem = processMemoryUsage();
    expect(mem.rss).toBeGreaterThanOrEqual(0);
    expect(mem.heapTotal).toBeGreaterThanOrEqual(0);
    expect(mem.heapUsed).toBeGreaterThanOrEqual(0);
    expect(mem.external).toBeGreaterThanOrEqual(0);
    expect(mem.arrayBuffers).toBeGreaterThanOrEqual(0);
  });

  test("formatProcessMemoryUsage formats all fields", () => {
    const formatted = formatProcessMemoryUsage({
      rss: 21_872_640,
      heapTotal: 591_872,
      heapUsed: 166_827,
      external: 11_803,
      arrayBuffers: 0,
    });
    expect(formatted.rss).toBe("21 MB");
    expect(formatted.heapTotal).toBe("1 MB");
    expect(formatted.heapUsed).toBe("0 MB");
    expect(formatted.external).toBe("0 MB");
    expect(formatted.arrayBuffers).toBe("0 MB");
  });

  test("formatMemoryBytes uses GB for values >= 1 GiB", () => {
    expect(formatMemoryBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  test("formatMemoryBytes uses MB for values < 1 GiB", () => {
    expect(formatMemoryBytes(21_872_640)).toBe("21 MB");
  });
});
