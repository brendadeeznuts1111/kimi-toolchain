import { describe, expect, test } from "bun:test";
import { sleep, sleepSync } from "../src/lib/bun-utils.ts";

describe("bun-utils-sleep", () => {
  test("sleep resolves after the requested delay", async () => {
    const start = performance.now();
    await sleep(50);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
  });

  test("sleep accepts a Date target", async () => {
    const target = new Date(Date.now() + 30);
    const start = performance.now();
    await sleep(target);
    expect(performance.now() - start).toBeGreaterThanOrEqual(20);
  });

  test("sleepSync blocks for at least the requested duration", () => {
    const start = performance.now();
    sleepSync(25);
    expect(performance.now() - start).toBeGreaterThanOrEqual(20);
  });
});
