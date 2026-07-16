/**
 * Bun.cron correctness smoke test.
 *
 * Bun v1.3.12 introduced Bun.cron() — in-process cron scheduler.
 * Later releases added OS-level registration, Bun.cron.parse(), and Bun.cron.remove().
 * This test verifies construction, parsing, and teardown. Full scheduling behavior
 * requires an integration test with timeouts.
 */
import { describe, expect, test } from "bun:test";

describe("bun-cron", () => {
  test("Bun.cron is available", () => {
    expect(typeof Bun.cron).toBe("function");
  });

  test("Bun.cron creates a stoppable job", () => {
    const job = Bun.cron("* * * * *", () => {});
    expect(typeof job.stop).toBe("function");
    job.stop();
  });

  test("invalid cron expression throws", () => {
    expect(() => {
      Bun.cron("not-a-cron-expr", () => {});
    }).toThrow();
  });

  test("Bun.cron.parse returns next Date for valid expressions", () => {
    const next = Bun.cron.parse("*/15 * * * *");
    expect(next).toBeInstanceOf(Date);
  });

  test("Bun.cron.parse handles named days and nicknames", () => {
    const weekday = Bun.cron.parse("0 9 * * MON-FRI");
    expect(weekday).toBeInstanceOf(Date);
    const yearly = Bun.cron.parse("@yearly");
    expect(yearly).toBeInstanceOf(Date);
  });

  test("Bun.cron.parse returns null for impossible dates", () => {
    const result = Bun.cron.parse("0 0 30 2 *");
    expect(result).toBeNull();
  });

  test("CronJob exposes schedule string via .cron property", () => {
    const job = Bun.cron("*/5 * * * *", () => {});
    expect(typeof job.cron).toBe("string");
    expect(job.cron).toBe("*/5 * * * *");
    job.stop();
  });

  test("CronJob.ref() keeps process alive (default behavior)", () => {
    const job = Bun.cron("0 * * * *", () => {});
    expect(typeof job.ref).toBe("function");
    expect(() => job.ref()).not.toThrow();
    job.stop();
  });

  test("CronJob.unref() allows process to exit", () => {
    const job = Bun.cron("0 * * * *", () => {});
    expect(typeof job.unref).toBe("function");
    expect(() => job.unref()).not.toThrow();
    job.stop();
  });

  test("CronJob is Disposable (Symbol.dispose)", () => {
    using job = Bun.cron("0 * * * *", () => {});
    expect(typeof job.stop).toBe("function");
  });

  test("Bun.cron.remove is available for OS-level job teardown", () => {
    expect(typeof Bun.cron.remove).toBe("function");
  });

  test("Bun.cron.remove for unknown job name does not throw", async () => {
    await expect(Bun.cron.remove("nonexistent-job-12345")).resolves.toBeUndefined();
  });
});
