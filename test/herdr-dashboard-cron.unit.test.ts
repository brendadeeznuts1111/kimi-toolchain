import { describe, expect, test, beforeEach, afterEach, mock, jest } from "bun:test";
import {
  buildCronSchedule,
  startDashboardCron,
  DashboardCronConfigError,
  DASHBOARD_CRON_MIN_MS,
} from "../src/lib/herdr-dashboard/cron.ts";

describe("herdr-dashboard-cron", () => {
  describe("buildCronSchedule", () => {
    test.each([
      [60_000, "*/1 * * * *"],
      [300_000, "*/5 * * * *"],
      [90_000, "*/2 * * * *"],
      [3_600_000, "*/60 * * * *"],
    ])("rounds %dms to %s", (ms, expected) => {
      expect(buildCronSchedule(ms)).toBe(expected);
    });

    test("rejects sub-minute intervals for cron", () => {
      expect(() => buildCronSchedule(59_999)).toThrow(DashboardCronConfigError);
      expect(() => buildCronSchedule(5000)).toThrow(DashboardCronConfigError);
    });

    test("error message includes the invalid value", () => {
      expect(() => buildCronSchedule(5000)).toThrow(/got 5000/);
    });
  });

  describe("startDashboardCron", () => {
    const bunRef = Bun as typeof Bun & { cron: typeof Bun.cron };
    const originalCron = Bun.cron;
    const cronJobs: Array<{
      schedule: string;
      callback: () => void | Promise<void>;
      stop: ReturnType<typeof mock>;
    }> = [];
    const activeHandles: Array<{ stop: () => void }> = [];

    const originalOnce = process.once;
    const originalOff = process.off;
    const sigtermListeners: Array<() => void> = [];
    const sigintListeners: Array<() => void> = [];

    beforeEach(() => {
      cronJobs.length = 0;
      activeHandles.length = 0;
      sigtermListeners.length = 0;
      sigintListeners.length = 0;

      bunRef.cron = ((schedule: string, callback: () => void | Promise<void>) => {
        const job = { schedule, callback, stop: mock(() => {}) };
        cronJobs.push(job);
        return job;
      }) as unknown as typeof Bun.cron;

      process.once = ((event: string, listener: () => void) => {
        if (event === "SIGTERM") sigtermListeners.push(listener);
        if (event === "SIGINT") sigintListeners.push(listener);
        return process;
      }) as unknown as typeof process.once;

      process.off = ((event: string, listener: () => void) => {
        const list = event === "SIGTERM" ? sigtermListeners : sigintListeners;
        const idx = list.indexOf(listener);
        if (idx >= 0) list.splice(idx, 1);
        return process;
      }) as unknown as typeof process.off;
    });

    afterEach(() => {
      for (const handle of activeHandles.splice(0)) {
        handle.stop();
      }
      jest.useRealTimers();
      bunRef.cron = originalCron;
      process.once = originalOnce;
      process.off = originalOff;
    });

    test("uses Bun.sleep loop for sub-minute poll intervals", () => {
      jest.useFakeTimers();
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      activeHandles.push(startDashboardCron({ ssePollMs: 5000, refresh, logger }));

      expect(jest.getTimerCount()).toBeGreaterThan(0);
      expect(cronJobs).toHaveLength(0);
    });

    test("sleep loop invokes refresh after initial delay", async () => {
      jest.useFakeTimers();
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      activeHandles.push(startDashboardCron({ ssePollMs: 5000, refresh, logger }));
      expect(refresh).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("registers Bun.cron for minute-or-longer poll intervals", () => {
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      activeHandles.push(startDashboardCron({ ssePollMs: DASHBOARD_CRON_MIN_MS, refresh, logger }));

      expect(cronJobs).toHaveLength(1);
      expect(cronJobs[0]?.schedule).toBe("*/1 * * * *");
    });

    test("dispose stops sleep loops and removes signal listeners", async () => {
      jest.useFakeTimers();
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      const disposable = startDashboardCron({ ssePollMs: 5000, refresh, logger });
      expect(sigtermListeners).toHaveLength(1);
      expect(sigintListeners).toHaveLength(1);

      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      const callsBeforeDispose = refresh.mock.calls.length;

      disposable[Symbol.dispose]();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(refresh.mock.calls.length).toBe(callsBeforeDispose);
      expect(sigtermListeners).toHaveLength(0);
      expect(sigintListeners).toHaveLength(0);
    });

    test("dispose stops cron jobs for minute-or-longer intervals", () => {
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      const disposable = startDashboardCron({ ssePollMs: DASHBOARD_CRON_MIN_MS, refresh, logger });
      disposable[Symbol.dispose]();

      expect(cronJobs[0]?.stop).toHaveBeenCalledTimes(1);
    });

    test("rejects sub-second poll intervals", () => {
      const refresh = mock(() => Promise.resolve());
      const logger = { debug: mock(() => {}), info: mock(() => {}) };

      expect(() => startDashboardCron({ ssePollMs: 500, refresh, logger })).toThrow(
        DashboardCronConfigError
      );
    });
  });
});
