/**
 * bun:test runtime TZ overrides — mirrors official dates-times guide.
 *
 * Unlike Jest, bun:test lets you change process.env.TZ multiple times per run.
 *
 * @see https://bun.sh/docs/test/dates-times#set-the-time-zone
 */

import { afterEach, describe, expect, test } from "bun:test";

describe("bun-tz-runtime", () => {
  let savedTz: string | undefined;

  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    savedTz = undefined;
  });

  test("Welcome to California!", () => {
    savedTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    expect(new Date().getTimezoneOffset()).toBe(420);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
  });

  test("Welcome to New York!", () => {
    savedTz = process.env.TZ;
    // Unlike in Jest, you can set the timezone multiple times at runtime and it will work.
    process.env.TZ = "America/New_York";
    expect(new Date().getTimezoneOffset()).toBe(240);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });

  test("can switch TZ again in a later test (bun:test, not Jest)", () => {
    savedTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    process.env.TZ = "America/New_York";
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });
});
