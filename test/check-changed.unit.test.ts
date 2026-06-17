import { describe, expect, test } from "bun:test";
import {
  changedIncludesTypeScript,
  filterFormatPaths,
  filterLintPaths,
  filterRelatedUnitTests,
} from "../src/lib/check-changed.ts";

describe("check-changed", () => {
  test("filterFormatPaths keeps repo format roots only", () => {
    expect(
      filterFormatPaths(["src/lib/foo.ts", "README.md", "scripts/check.ts", "random.txt"])
    ).toEqual(["src/lib/foo.ts", "scripts/check.ts"]);
  });

  test("changedIncludesTypeScript detects ts/tsx", () => {
    expect(changedIncludesTypeScript(["README.md"])).toBe(false);
    expect(changedIncludesTypeScript(["src/foo.ts", "web/app.tsx"])).toBe(true);
  });

  test("filterLintPaths keeps JS/TS sources", () => {
    expect(filterLintPaths(["src/a.ts", "docs/foo.md", "scripts/b.js"])).toEqual([
      "src/a.ts",
      "scripts/b.js",
    ]);
  });

  test("filterRelatedUnitTests maps changed module to unit test file", () => {
    const related = filterRelatedUnitTests(["src/lib/gate-runner.ts"]);
    expect(related.some((path) => path.includes("gate-runner"))).toBe(true);
  });
});
