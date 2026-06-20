import { describe, expect, test } from "bun:test";

interface NodeCompatTimer {
  _idleStart: number;
}

function asNodeCompatTimer(timer: ReturnType<typeof setTimeout>): NodeCompatTimer {
  return timer as unknown as NodeCompatTimer;
}

describe("bun-timer-idle-start", () => {
  test("setTimeout returns a Timeout with Node-compatible _idleStart", () => {
    const before = performance.now();
    const timer = setTimeout(() => {}, 1_000);
    try {
      const idleStart = asNodeCompatTimer(timer)._idleStart;
      expect(typeof idleStart).toBe("number");
      expect(Number.isFinite(idleStart)).toBe(true);
      expect(idleStart).toBeGreaterThanOrEqual(0);
      expect(idleStart).toBeLessThanOrEqual(before + 1_000);
    } finally {
      clearTimeout(timer);
    }
  });

  test("setInterval returns a Timeout with _idleStart and reschedules it", async () => {
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
    }, 10);

    try {
      const timer = asNodeCompatTimer(interval);
      const initialIdleStart = timer._idleStart;
      expect(typeof initialIdleStart).toBe("number");
      expect(Number.isFinite(initialIdleStart)).toBe(true);

      await Bun.sleep(35);

      expect(ticks).toBeGreaterThan(0);
      expect(timer._idleStart).toBeGreaterThanOrEqual(initialIdleStart);
    } finally {
      clearInterval(interval);
    }
  });
});
