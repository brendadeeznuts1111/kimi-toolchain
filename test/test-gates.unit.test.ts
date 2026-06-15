import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  bunTestArgs,
  FAST_TEST_TIMEOUT_MS,
  INTEGRATION_TEST_FILES,
  SMOKE_TEST_FILES,
  UNIT_TEST_FILES,
  useFastUnitCoverage,
} from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("test-gates", () => {
  test("bunTestArgs defaults include bail and 5s timeout", () => {
    expect(bunTestArgs({ bail: true })).toEqual(["test", "--timeout", "5000", "--bail"]);
  });

  test("bunTestArgs fast mode uses the configured timeout and unit files", () => {
    const args = bunTestArgs({ fast: true, bail: true });
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

  test("all test files declare a unit, integration, or smoke class in their filename", async () => {
    const allTests = await discoverTestFiles("test/**/*.test.ts");
    const unclassifiedTests = allTests.filter(
      (file) =>
        !file.endsWith(".unit.test.ts") &&
        !file.endsWith(".integration.test.ts") &&
        !file.endsWith(".smoke.test.ts")
    );

    expect(unclassifiedTests).toEqual([]);
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
