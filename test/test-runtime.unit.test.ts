import { describe, expect, test } from "bun:test";
import {
  TEST_TIER_ORDER,
  TEST_TIER_SPECS,
  buildTestRunnerEnv,
  bunTestArgsForTier,
} from "../src/lib/test-runtime.ts";

describe("test-runtime", () => {
  test("buildTestRunnerEnv forces NODE_ENV=test", () => {
    const env = buildTestRunnerEnv({ NODE_ENV: "development" });
    expect(env.NODE_ENV).toBe("test");
  });

  test("buildTestRunnerEnv defaults TZ to UTC", () => {
    const env = buildTestRunnerEnv({});
    expect(env.TZ).toBe("Etc/UTC");
  });

  test("tier order runs unit before integration and smoke", () => {
    expect(TEST_TIER_ORDER).toEqual(["unit", "integration", "smoke"]);
  });

  test("unit tier uses parallel isolate args", () => {
    const args = bunTestArgsForTier(TEST_TIER_SPECS.unit);
    expect(args).toContain("--isolate");
    expect(args).toContain("--parallel");
    expect(args[0]).toBe("test");
  });
});