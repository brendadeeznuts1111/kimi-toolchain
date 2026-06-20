import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ParallelGovernor } from "../src/lib/governor-parallel.ts";

describe("governor-parallel", () => {
  test("runs tasks within maxConcurrent limit", async () => {
    const gov = new ParallelGovernor(2);
    expect(gov.available).toBe(2);
    expect(gov.queued).toBe(0);

    const order: number[] = [];
    const tasks = [1, 2, 3].map((i) =>
      Effect.runPromise(
        gov.run(async () => {
          order.push(i);
          await Bun.sleep(50);
          return i;
        })
      )
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3]);
    expect(order.length).toBe(3);
    expect(gov.available).toBe(2);
    expect(gov.queued).toBe(0);
  });

  test("queues excess tasks and releases slots correctly", async () => {
    const gov = new ParallelGovernor(1);
    const timestamps: number[] = [];

    const tasks = [1, 2].map((i) =>
      Effect.runPromise(
        gov.run(async () => {
          timestamps.push(Date.now());
          await Bun.sleep(100);
          return i;
        })
      )
    );

    // Immediately after starting, one should be running and one queued
    // Give a tick for the first to acquire and the second to queue
    await Bun.sleep(10);
    expect(gov.available).toBe(0);
    expect(gov.queued).toBe(1);

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2]);

    // The second task should start at least 80ms after the first
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(80);
    expect(gov.available).toBe(1);
    expect(gov.queued).toBe(0);
  });

  test("releases slot even when fn throws", async () => {
    const gov = new ParallelGovernor(1);

    const p1 = Effect.runPromise(
      gov.run(async () => {
        throw new Error("intentional failure");
      })
    );

    await expect(p1).rejects.toThrow("intentional failure");
    expect(gov.available).toBe(1);
    expect(gov.queued).toBe(0);
  });

  test("preserves fn return value", async () => {
    const gov = new ParallelGovernor(2);

    const result = await Effect.runPromise(
      gov.run(async () => {
        await Bun.sleep(10);
        return { ok: true, value: 42 };
      })
    );

    expect(result).toEqual({ ok: true, value: 42 });
  });

  test("handles many concurrent tasks with small limit", async () => {
    const gov = new ParallelGovernor(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 8 }, (_, i) =>
      Effect.runPromise(
        gov.run(async () => {
          running++;
          if (running > maxRunning) maxRunning = running;
          await Bun.sleep(30);
          running--;
          return i;
        })
      )
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(2);
    expect(gov.available).toBe(2);
    expect(gov.queued).toBe(0);
  });
});
