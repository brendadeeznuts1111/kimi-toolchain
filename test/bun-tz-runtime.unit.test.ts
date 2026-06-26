/**
 * bun:test runtime TZ overrides — mirrors official dates-times guide.
 *
 * Unlike Jest, bun:test lets you change Bun.env.TZ multiple times per run.
 *
 * @see https://bun.sh/docs/test/dates-times#set-the-time-zone
 */

import { afterEach, describe, expect, test } from "bun:test";

describe("bun-tz-runtime", () => {
  let savedTz: string | undefined;

  afterEach(() => {
    if (savedTz === undefined) delete Bun.env.TZ;
    else Bun.env.TZ = savedTz;
    savedTz = undefined;
  });

  test("Welcome to California!", () => {
    savedTz = Bun.env.TZ;
    Bun.env.TZ = "America/Los_Angeles";
    expect(new Date().getTimezoneOffset()).toBe(420);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
  });

  test("Welcome to New York!", () => {
    savedTz = Bun.env.TZ;
    // Unlike in Jest, you can set the timezone multiple times at runtime and it will work.
    Bun.env.TZ = "America/New_York";
    expect(new Date().getTimezoneOffset()).toBe(240);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });

  test("can switch TZ again in a later test (bun:test, not Jest)", () => {
    savedTz = Bun.env.TZ;
    Bun.env.TZ = "America/Los_Angeles";
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    Bun.env.TZ = "America/New_York";
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
  });
});
