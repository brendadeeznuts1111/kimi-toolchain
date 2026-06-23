import { describe, expect, it } from "bun:test";
import { buildDefineLineMap, lintDefineJson } from "../scripts/lint-build-constants.ts";

describe("lint-build-constants", () => {
  describe("lintDefineJson", () => {
    it("accepts valid JSON string literals", () => {
      const violations = lintDefineJson(`
[define]
KIMI_STRING = '"1.0.0"'
KIMI_NUMBER = "5"
KIMI_BOOL = "true"
KIMI_OBJECT = '{"a":1}'
`);
      expect(violations).toHaveLength(0);
    });

    it("reports a string value missing inner quotes as invalid JSON", () => {
      const violations = lintDefineJson(`
[define]
KIMI_VERSION = "1.0.0"
`);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toMatch(/KIMI_VERSION/);
      expect(violations[0]).toMatch(/not valid JSON/);
    });

    it("reports malformed JSON objects", () => {
      const violations = lintDefineJson(`
[define]
KIMI_OBJECT = '{"a":}'
`);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toMatch(/KIMI_OBJECT/);
    });

    it("reports invalid TOML at the top level", () => {
      const violations = lintDefineJson("this is not toml [[");
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toMatch(/invalid TOML/);
    });

    it("returns no violations when [define] is absent", () => {
      const violations = lintDefineJson(`
[install]
frozenLockfile = true
`);
      expect(violations).toHaveLength(0);
    });
  });

  describe("buildDefineLineMap", () => {
    it("records line numbers for define keys", () => {
      const map = buildDefineLineMap(`
[define]
# define-domain:demo
KIMI_FOO = "1"
KIMI_BAR = '"2"'
`);
      expect(map.get("KIMI_FOO")).toBe(4);
      expect(map.get("KIMI_BAR")).toBe(5);
    });
  });
});
