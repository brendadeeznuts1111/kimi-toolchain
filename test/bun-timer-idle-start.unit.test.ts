import { describe, expect, test } from "bun:test";

interface NodeCompatTimer {
  _idleStart: number;
  refresh: () => NodeCompatTimer;
}

function asNodeCompatTimer(timer: ReturnType<typeof setTimeout>): NodeCompatTimer {
  return timer as unknown as NodeCompatTimer;
}

describe("bun-timer-idle-start", () => {
  test("setTimeout returns a Timeout with Node-compatible _idleStart", () => {
    const timer = setTimeout(() => {}, 1_000);
    try {
      const idleStart = asNodeCompatTimer(timer)._idleStart;
      expect(typeof idleStart).toBe("number");
      expect(Number.isFinite(idleStart)).toBe(true);
      expect(idleStart).toBeGreaterThanOrEqual(0);
    } finally {
      clearTimeout(timer);
    }
  });

  test("newer timeouts receive non-decreasing _idleStart values", async () => {
    const first = setTimeout(() => {}, 1_000);
    try {
      await Bun.sleep(5);
      const second = setTimeout(() => {}, 1_000);
      try {
        expect(asNodeCompatTimer(second)._idleStart).toBeGreaterThanOrEqual(
          asNodeCompatTimer(first)._idleStart
        );
      } finally {
        clearTimeout(second);
      }
    } finally {
      clearTimeout(first);
    }
  });

  test("Timeout.refresh updates _idleStart to the reschedule time", async () => {
    const timeout = setTimeout(() => {}, 1_000);
    try {
      const timer = asNodeCompatTimer(timeout);
      const initialIdleStart = timer._idleStart;

      await Bun.sleep(20);
      const refreshed = timer.refresh();

      expect(refreshed).toBe(timer);
      expect(timer._idleStart).toBeGreaterThan(initialIdleStart);
    } finally {
      clearTimeout(timeout);
    }
  });

  test("setInterval keeps _idleStart available while ticking", async () => {
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
      expect(typeof timer._idleStart).toBe("number");
      expect(Number.isFinite(timer._idleStart)).toBe(true);
      expect(timer._idleStart).toBeGreaterThanOrEqual(initialIdleStart);
    } finally {
      clearInterval(interval);
    }
  });
});
