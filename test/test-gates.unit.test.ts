import { describe, expect, test } from "bun:test";
import {
  bunTestArgs,
  FAST_TEST_TIMEOUT_MS,
  UNIT_TEST_FILES,
  useFastUnitCoverage,
} from "../src/lib/test-gates.ts";

describe("test-gates", () => {
  test("bunTestArgs defaults include bail and 5s timeout", () => {
    expect(bunTestArgs({ bail: true })).toEqual(["test", "--timeout", "5000", "--bail"]);
  });

  test("bunTestArgs fast mode uses 100ms and unit files", () => {
    const args = bunTestArgs({ fast: true, bail: true });
    expect(args).toContain("--timeout");
    expect(args).toContain(String(FAST_TEST_TIMEOUT_MS));
    expect(args).toContain("--bail");
    for (const file of UNIT_TEST_FILES) {
      expect(args).toContain(file);
    }
  });

  test("bunTestArgs ci mode uses 60s timeout and junit reporter", () => {
    expect(bunTestArgs({ coverage: true, ci: true, bail: true })).toEqual([
      "test",
      "--timeout",
      "60000",
      "--bail",
      "--coverage",
      "--coverage-dir",
      ".kimi-artifacts/coverage",
      "--reporter=junit",
      "--reporter-outfile=.kimi-artifacts/reports/junit.xml",
    ]);
  });

  test("bunTestArgs ci mode supports isolated report files", () => {
    expect(
      bunTestArgs({ ci: true, reporterOutfile: ".kimi-artifacts/reports/unit.xml" })
    ).toContain("--reporter-outfile=.kimi-artifacts/reports/unit.xml");
  });

  test("useFastUnitCoverage is repo-specific", () => {
    expect(useFastUnitCoverage("kimi-toolchain")).toBe(true);
    expect(useFastUnitCoverage("other-project")).toBe(false);
  });
});
