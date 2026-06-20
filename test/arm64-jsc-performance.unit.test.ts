/**
 * ARM64 JavaScriptCore performance regression guards (Bun v1.3.7 JSC upgrade).
 *
 * On Apple Silicon and other ARM64 targets, JSC now emits conditional compare
 * chains (ccmp/ccmn) for compound boolean expressions like `if (x === 0 && y === 1)`,
 * and materializes floating-point constants in vector registers instead of loading
 * from memory.
 *
 * Correctness cases run on every platform; micro-benchmarks are ARM64-only.
 *
 * @see https://bun.com/blog/bun-v1.3.7#arm64-performance-improvements
 */
import { describe, expect, test } from "bun:test";

const isArm64 = process.arch === "arm64";

function evalCompoundEqual(x: number, y: number): boolean {
  return x === 0 && y === 1;
}

function evalCompoundChain(a: number, b: number, c: number): boolean {
  return a === 1 && b === 2 && c === 3;
}

function compoundCompareLoop(iterations: number): number {
  let x = 0;
  let y = 1;
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    if (x === 0 && y === 1) count++;
    x = (x + 1) % 3;
    y = (y + 1) % 3;
  }
  return count;
}

function fpConstantLoop(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += i * 1.5 + 2.71828 + 3.14159;
  }
  return sum;
}

function warmup(loop: () => void, iterations = 100_000): void {
  for (let i = 0; i < iterations; i++) loop();
}

function benchPerOp(loop: (iterations: number) => number, iterations: number): number {
  warmup(() => loop(10_000));
  const start = Bun.nanoseconds();
  const result = loop(iterations);
  expect(result).not.toBeNaN();
  return (Bun.nanoseconds() - start) / 1e3 / iterations;
}

describe("arm64-jsc-performance", () => {
  test("guide example: if (x === 0 && y === 1) compound compare is correct", () => {
    expect(evalCompoundEqual(0, 1)).toBe(true);
    expect(evalCompoundEqual(0, 0)).toBe(false);
    expect(evalCompoundEqual(1, 1)).toBe(false);
    expect(evalCompoundEqual(1, 0)).toBe(false);
  });

  test("three-way equality && chain evaluates correctly", () => {
    expect(evalCompoundChain(1, 2, 3)).toBe(true);
    expect(evalCompoundChain(1, 2, 0)).toBe(false);
    expect(evalCompoundChain(0, 2, 3)).toBe(false);
  });

  test(`runtime arch=${process.arch} arm64JscBench=${isArm64}`, () => {
    if (!isArm64) {
      console.warn(
        "[arm64-jsc-performance] micro-benchmarks skipped — requires process.arch === 'arm64'"
      );
    }
    expect(typeof isArm64).toBe("boolean");
  });

  test.skipIf(!isArm64)(
    "compound compare loop (x === 0 && y === 1) stays within ARM64 budget",
    () => {
      const iterations = 2_000_000;
      const elapsed = benchPerOp(compoundCompareLoop, iterations);
      console.log(`  compound && compare: ${elapsed.toFixed(4)} µs/op (JSC ccmp/ccmn on ARM64)`);
      // 0.1 µs/op — ~13× headroom over typical Apple Silicon timings
      expect(elapsed).toBeLessThan(0.1);
      // Starting x=0,y=1 matches at i=0, then every third step → ceil(n/3) hits.
      expect(compoundCompareLoop(iterations)).toBe(Math.ceil(iterations / 3));
    }
  );

  test.skipIf(!isArm64)("floating-point constant loop stays within ARM64 budget", () => {
    const iterations = 2_000_000;
    const elapsed = benchPerOp(fpConstantLoop, iterations);
    console.log(`  fp constant materialization: ${elapsed.toFixed(4)} µs/op (ARM64 vector regs)`);
    // 0.05 µs/op — generous guard for register-materialized constants
    expect(elapsed).toBeLessThan(0.05);
    expect(fpConstantLoop(4)).toBeGreaterThan(0);
  });
});
