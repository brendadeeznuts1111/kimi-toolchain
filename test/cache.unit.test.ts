import { describe, expect, test } from "bun:test";
import { TtlCache } from "../src/lib/cache.ts";

describe("cache", () => {
  test("get/set respects TTL", async () => {
    const cache = new TtlCache<string>({ ttlMs: 40 });
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
    expect(cache.stats().hits).toBe(1);
    await Bun.sleep(50);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  test("peek returns stale entries for SWR", async () => {
    const cache = new TtlCache<number>({ ttlMs: 20 });
    cache.set("n", 7);
    await Bun.sleep(25);
    const peek = cache.peek("n");
    expect(peek?.value).toBe(7);
    expect(peek?.stale).toBe(true);
    expect(cache.get("n")).toBeUndefined();
  });

  test("getOrCompute coalesces concurrent compute", async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    let computeCount = 0;
    const compute = async () => {
      computeCount += 1;
      await Bun.sleep(10);
      return 99;
    };
    const [a, b] = await Promise.all([
      cache.getOrCompute("x", compute),
      cache.getOrCompute("x", compute),
    ]);
    expect(a).toBe(99);
    expect(b).toBe(99);
    expect(computeCount).toBe(1);
  });

  test("invalidate removes entries", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    cache.set("a", "1");
    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });
});
