import { describe, expect, test } from "bun:test";
import {
  filterBannedTermPaths,
  filterChangedTestPaths,
  filterDocLinkPaths,
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
    expect(filterDocLinkPaths(changed)).toEqual(["src/a.ts"]);
  });

  test("filterDocLinkPaths keeps src ts only", () => {
    expect(filterDocLinkPaths(["src/a.ts", "test/b.ts", "README.md"])).toEqual(["src/a.ts"]);
    expect(filterDocLinkPaths(["src/node_modules/pkg/index.ts"])).toEqual([]);
  });

  test("shouldRunScopedLint true for src-only doc-link paths", () => {
    expect(shouldRunScopedLint(["src/lib/foo.ts"])).toBe(true);
  });

  test("scopedLintNoticeLine mentions doc-links and skipped full lint checks", () => {
    expect(scopedLintNoticeLine()).toContain("scoped");
    expect(scopedLintNoticeLine()).toContain("doc-links");
    expect(scopedLintNoticeLine()).toContain("bun-native-lint");
  });
});
