import { describe, expect, it } from "bun:test";
import { lintTestNames } from "../scripts/lint-test-names.ts";

describe("lint-test-names", () => {
  it("should pass for the canonical repo test layout", async () => {
    const violations = await lintTestNames();
    expect(violations).toEqual([]);
  });
});
