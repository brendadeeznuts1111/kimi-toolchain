import { describe, expect, test } from "bun:test";
import { createInflightCoalescer } from "../src/lib/bun-utils.ts";

describe("run-if-not-inflight", () => {
  test("skips second call while first is pending", async () => {
    let runs = 0;
    const coalesce = createInflightCoalescer();

    coalesce(async () => {
      runs++;
      await Bun.sleep(50);
    });
    coalesce(async () => {
      runs++;
    });

    await Bun.sleep(80);
    expect(runs).toBe(1);
  });

  test("allows new run after previous fulfilled", async () => {
    let runs = 0;
    const coalesce = createInflightCoalescer();

    coalesce(async () => {
      runs++;
    });
    await Bun.sleep(5);

    coalesce(async () => {
      runs++;
    });
    await Bun.sleep(5);

    expect(runs).toBe(2);
  });
});
