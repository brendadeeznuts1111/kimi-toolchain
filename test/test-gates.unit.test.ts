import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TEST_TIMEOUT_MS,
  FAST_TEST_TIMEOUT_MS,
  INTEGRATION_TEST_FILES,
  SMOKE_TEST_FILES,
  TEST_GROUPS,
  UNIT_TEST_FILES,
  useFastUnitCoverage,
  validateTestGroupCoverage,
} from "../src/lib/test-gates.ts";
import { buildBunTestArgs } from "../src/lib/test-runtime.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("test-gates", () => {
  test("buildBunTestArgs defaults include default timeout and isolate", () => {
    expect(buildBunTestArgs({ bail: true })).toEqual([
      "test",
      "--timeout",
      String(DEFAULT_TEST_TIMEOUT_MS),
      "--bail",
      "--isolate",
    ]);
  });

  test("buildBunTestArgs fast mode uses the configured timeout and unit files", () => {
    const args = buildBunTestArgs({ fast: true, bail: true });
    expect(args).toContain("--timeout");
    expect(args).toContain(String(FAST_TEST_TIMEOUT_MS));
    expect(args).toContain("--bail");
    for (const file of UNIT_TEST_FILES) {
      expect(args).toContain(file);
    }
  });

  test("fast gate includes every unit-named test file", async () => {
    const discoveredUnitTests = await discoverTestFiles("test/**/*.unit.test.ts");

    const configuredUnitTests = new Set<string>(UNIT_TEST_FILES);
    const missingFromFastGate = discoveredUnitTests
      .sort()
      .filter((file) => !configuredUnitTests.has(file));

    expect(missingFromFastGate).toEqual([]);
  });

  test("integration gate includes every integration-named test file", async () => {
    const discoveredIntegrationTests = await discoverTestFiles("test/**/*.integration.test.ts");
    const configuredIntegrationTests = new Set<string>(INTEGRATION_TEST_FILES);
    const missingFromIntegrationGate = discoveredIntegrationTests
      .sort()
      .filter((file) => !configuredIntegrationTests.has(file));

    expect(missingFromIntegrationGate).toEqual([]);
  });

  test("smoke gate includes every smoke-named test file", async () => {
    const discoveredSmokeTests = await discoverTestFiles("test/**/*.smoke.test.ts");
    const configuredSmokeTests = new Set<string>(SMOKE_TEST_FILES);
    const missingFromSmokeGate = discoveredSmokeTests
      .sort()
      .filter((file) => !configuredSmokeTests.has(file));

    expect(missingFromSmokeGate).toEqual([]);
  });

  test("all test files declare a gate class in their filename", async () => {
    const allTests = await discoverTestFiles("test/**/*.test.ts");
    const classifiedSuffixes = [
      ".unit.test.ts",
      ".integration.test.ts",
      ".smoke.test.ts",
      ".db.test.ts",
      ".router.test.ts",
    ];
    const unclassifiedTests = allTests.filter(
      (file) => !classifiedSuffixes.some((suffix) => file.endsWith(suffix))
    );

    expect(unclassifiedTests).toEqual([]);
  });

  test("TEST_GROUPS covers every unit file exactly once", () => {
    const { ok, orphans, duplicates } = validateTestGroupCoverage(REPO_ROOT);
    expect(orphans).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(ok).toBe(true);
    expect(Object.keys(TEST_GROUPS).length).toBeGreaterThanOrEqual(10);
  });

  test("buildBunTestArgs ci mode uses CI timeout and junit reporter", () => {
    expect(buildBunTestArgs({ coverage: true, ci: true, bail: true })).toEqual([
      "test",
      "--timeout",
      "30000",
      "--bail",
      "--coverage",
      "--coverage-reporter=lcov",
      "--coverage-dir=./coverage",
      "--reporter=junit",
      "--reporter-outfile=reports/junit.xml",
      "--isolate",
    ]);
  });

  test("buildBunTestArgs ci mode supports isolated report files", () => {
    expect(
      buildBunTestArgs({ ci: true, reporterOutfile: ".kimi-artifacts/reports/unit.xml" })
    ).toContain("--reporter-outfile=.kimi-artifacts/reports/unit.xml");
  });

  test("useFastUnitCoverage is repo-specific", () => {
    expect(useFastUnitCoverage("kimi-toolchain")).toBe(true);
    expect(useFastUnitCoverage("other-project")).toBe(false);
  });
});

async function discoverTestFiles(pattern: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob(pattern).scan({
    cwd: REPO_ROOT,
    absolute: false,
  })) {
    files.push(file);
  }
  return files;
}
