/**
 * Buffer.swap16 / swap64 performance regression test.
 *
 * Bun v1.3.7: swap16 1.8x faster, swap64 3.6x faster via CPU intrinsics.
 * Blog benchmarks (64KB buffer): swap16 ~0.56 µs, swap64 ~0.56 µs.
 */
import { describe, expect, test } from "bun:test";

const BUF_64K = Buffer.alloc(64 * 1024);

describe("bun-buffer-swap", () => {
  test("swap16 completes under 5µs on 64KB", () => {
    const buf = Buffer.from(BUF_64K);
    const start = Bun.nanoseconds();
    buf.swap16();
    const elapsed = (Bun.nanoseconds() - start) / 1e3;
    console.log(`  swap16 64KB: ${elapsed.toFixed(2)} µs (blog: ~0.56 µs)`);
    expect(elapsed).toBeLessThan(5);
  });

  test("swap64 completes under 5µs on 64KB", () => {
    const buf = Buffer.from(BUF_64K);
    const start = Bun.nanoseconds();
    buf.swap64();
    const elapsed = (Bun.nanoseconds() - start) / 1e3;
    console.log(`  swap64 64KB: ${elapsed.toFixed(2)} µs (blog: ~0.56 µs)`);
    expect(elapsed).toBeLessThan(5);
  });

  test("swap16 roundtrip preserves original data", () => {
    const original = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const copy = Buffer.from(original);
    copy.swap16();
    copy.swap16();
    expect(copy).toEqual(original);
  });
});
