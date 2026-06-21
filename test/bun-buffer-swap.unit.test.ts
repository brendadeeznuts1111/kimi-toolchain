/**
 * Buffer.swap16 / swap64 performance regression test.
 *
 * Bun v1.3.7: swap16 1.8x faster, swap64 3.6x faster via CPU intrinsics.
 * Blog benchmarks (64KB buffer): swap16 ~0.56 µs, swap64 ~0.56 µs.
 */
import { describe, expect, test } from "bun:test";

const BUF_64K = Buffer.alloc(64 * 1024);

describe("bun-buffer-swap", () => {
  test("swap16 min of 5 iterations completes under 50µs on 64KB", () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const buf = Buffer.from(BUF_64K);
      const start = Bun.nanoseconds();
      buf.swap16();
      samples.push((Bun.nanoseconds() - start) / 1e3);
    }
    const min = Math.min(...samples);
    console.log(`  swap16 64KB min/5: ${min.toFixed(2)} µs (blog: ~0.56 µs)`);
    expect(min).toBeLessThan(50);
  });

  test("swap64 min of 5 iterations completes under 50µs on 64KB", () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const buf = Buffer.from(BUF_64K);
      const start = Bun.nanoseconds();
      buf.swap64();
      samples.push((Bun.nanoseconds() - start) / 1e3);
    }
    const min = Math.min(...samples);
    console.log(`  swap64 64KB min/5: ${min.toFixed(2)} µs (blog: ~0.56 µs)`);
    expect(min).toBeLessThan(50);
  });

  test("swap16 roundtrip preserves original data", () => {
    const original = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const copy = Buffer.from(original);
    copy.swap16();
    copy.swap16();
    expect(copy).toEqual(original);
  });
});
