import { describe, expect, test } from "bun:test";
import {
  filterBannedTermPaths,
  filterChangedTestPaths,
  filterPatternPaths,
  scopedLintNoticeLine,
  shouldRunScopedLint,
} from "../src/lib/check-lint-scoped.ts";

describe("check-lint-scoped", () => {
  test("shouldRunScopedLint detects lintable and doc paths", () => {
    expect(shouldRunScopedLint(["README.md"])).toBe(true);
    expect(shouldRunScopedLint(["src/lib/foo.ts"])).toBe(true);
    expect(shouldRunScopedLint(["test/foo.unit.test.ts"])).toBe(true);
    expect(shouldRunScopedLint(["coverage/out.txt"])).toBe(false);
  });

  test("filter helpers partition changed paths", () => {
    const changed = ["src/a.ts", "docs/b.md", "test/c.unit.test.ts", "README"];
    expect(filterBannedTermPaths(changed)).toEqual([
      "src/a.ts",
      "docs/b.md",
      "test/c.unit.test.ts",
    ]);
    expect(filterPatternPaths(changed)).toEqual(["src/a.ts"]);
    expect(filterChangedTestPaths(changed)).toEqual(["test/c.unit.test.ts"]);
  });

  test("scopedLintNoticeLine mentions skipped full lint checks", () => {
    expect(scopedLintNoticeLine()).toContain("scoped");
    expect(scopedLintNoticeLine()).toContain("bun-native-lint");
  });
});
