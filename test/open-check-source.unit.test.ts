import { describe, expect, test } from "bun:test";
import { openFirstFailedCheck, parseCheckSource } from "../src/lib/health-check.ts";

describe("open-check-source", () => {
  test("parseCheckSource extracts file:line:col", () => {
    expect(parseCheckSource("failed at src/foo.ts:42:3")).toEqual({
      file: "src/foo.ts",
      line: 42,
      column: 3,
    });
  });

  test("openFirstFailedCheck returns false when no source", () => {
    expect(
      openFirstFailedCheck([
        { name: "x", status: "error", message: "no path here", fixable: false },
      ])
    ).toBe(false);
  });
});
