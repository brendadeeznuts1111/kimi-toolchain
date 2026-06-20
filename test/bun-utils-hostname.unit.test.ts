import { describe, expect, test } from "bun:test";
import { hostname } from "os";
import { runtimeHostname } from "../src/lib/bun-utils.ts";

describe("runtimeHostname wrapper", () => {
  test("matches os.hostname()", () => {
    expect(runtimeHostname()).toBe(hostname());
  });

  test("returns a non-empty string", () => {
    expect(runtimeHostname().length).toBeGreaterThan(0);
  });
});