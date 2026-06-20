/**
 * Bun.cron correctness smoke test.
 *
 * Bun v1.3.12 introduced Bun.cron() — in-process cron scheduler.
 * This test verifies construction and teardown. Full scheduling behavior
 * requires an integration test with timeouts.
 */
import { describe, expect, test } from "bun:test";

describe("bun-cron", () => {
  test("Bun.cron is available", () => {
    expect(typeof Bun.cron).toBe("function");
  });

  test("Bun.cron creates a stoppable job", () => {
    let _fired = false;
    const job = Bun.cron("* * * * *", () => {
      _fired = true;
    });
    expect(typeof job.stop).toBe("function");
    job.stop();
    // Job should not fire after stop (though timing-dependent)
  });

  test("invalid cron expression throws", () => {
    expect(() => {
      Bun.cron("not-a-cron-expr", () => {});
    }).toThrow();
  });
});
