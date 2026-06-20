/**
 * Bun-native Buffer.from(array) performance regression test.
 *
 * Bun uses JSC bulk copy for plain JavaScript arrays passed to Buffer.from(),
 * bypassing per-element construction overhead. Blog benchmarks report:
 *
 *   8 elements   ~50% faster
 *   64 elements  ~42% faster
 *   1024 elements ~29% faster
 *
 * This test guards the fast path and verifies integer + float array inputs.
 *
 * @see https://bun.com/blog/bun-v1.3.7#faster-buffer-from-with-arrays
 */
import { describe, expect, test } from "bun:test";

function benchBufferFrom(data: number[], iterations: number): number {
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) Buffer.from(data);
  return (Bun.nanoseconds() - start) / 1e3 / iterations;
}

describe("buffer-from-performance", () => {
  test("guide example: Buffer.from([1..8]) produces expected bytes", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const buf = Buffer.from(data);
    expect([...buf]).toEqual(data);
    expect(buf.length).toBe(8);
  });

  test("Buffer.from 8-element int array completes under 2µs/op", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const elapsed = benchBufferFrom(data, 300_000);
    console.log(
      `  Buffer.from([8] int): ${elapsed.toFixed(3)} µs/op (blog: ~50% faster vs pre-bulk-copy)`
    );
    expect(elapsed).toBeLessThan(2);
  });

  test("Buffer.from 64-element int array completes under 5µs/op", () => {
    const data = Array.from({ length: 64 }, (_, i) => i & 0xff);
    const elapsed = benchBufferFrom(data, 100_000);
    console.log(`  Buffer.from([64] int): ${elapsed.toFixed(3)} µs/op (blog: ~42% faster)`);
    expect(elapsed).toBeLessThan(5);
  });

  test("Buffer.from 1024-element int array completes under 15µs/op", () => {
    const data = Array.from({ length: 1024 }, (_, i) => i & 0xff);
    const elapsed = benchBufferFrom(data, 30_000);
    console.log(`  Buffer.from([1024] int): ${elapsed.toFixed(3)} µs/op (blog: ~29% faster)`);
    expect(elapsed).toBeLessThan(15);
  });

  test("Buffer.from float arrays round-trip via truncation", () => {
    const data = [1.9, 2.1, 255.7, 0.4, 5.5, 6.5, 7.5, 8.5];
    const buf = Buffer.from(data);
    expect([...buf]).toEqual([1, 2, 255, 0, 5, 6, 7, 8]);
    const elapsed = benchBufferFrom(data, 300_000);
    console.log(`  Buffer.from([8] float): ${elapsed.toFixed(3)} µs/op`);
    expect(elapsed).toBeLessThan(2);
  });
});
