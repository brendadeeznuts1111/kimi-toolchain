import { describe, expect, test } from "bun:test";
import { withNoOrphansEnv } from "../src/lib/bun-spawn-env.ts";

function mergeSpawnEnv(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env = withNoOrphansEnv();
  if (!overrides) return env;
  for (const [key, value] of Object.entries(overrides)) {
    if (value != null) env[key] = value;
    else delete env[key];
  }
  return env;
}

describe("bun-spawn-env", () => {
  describe("with-no-orphans-env", () => {
    test("sets BUN_FEATURE_FLAG_NO_ORPHANS=1 on non-win32", () => {
      const env = withNoOrphansEnv({ SAMPLE: "value" });
      expect(env.SAMPLE).toBe("value");
      if (process.platform === "win32") {
        expect(env.BUN_FEATURE_FLAG_NO_ORPHANS).toBeUndefined();
        return;
      }
      expect(env.BUN_FEATURE_FLAG_NO_ORPHANS).toBe("1");
    });
  });

  describe("merge-spawn-env", () => {
    test("caller overrides win on key collision", () => {
      const env = mergeSpawnEnv({ CUSTOM: "yes", BUN_FEATURE_FLAG_NO_ORPHANS: "0" });
      expect(env.CUSTOM).toBe("yes");
      expect(env.BUN_FEATURE_FLAG_NO_ORPHANS).toBe("0");
    });

    test("includes no-orphans flag on non-win32 when no overrides", () => {
      const env = mergeSpawnEnv();
      if (process.platform === "win32") {
        expect(env.BUN_FEATURE_FLAG_NO_ORPHANS).toBeUndefined();
        return;
      }
      expect(env.BUN_FEATURE_FLAG_NO_ORPHANS).toBe("1");
    });
  });
});
