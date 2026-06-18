import { describe, expect, test } from "bun:test";
import { withNoOrphansEnv } from "../src/lib/bun-spawn-env.ts";
import {
  execFileSync,
  mergeSpawnEnv,
  spawnInherit,
  spawnQuiet,
} from "../src/lib/bun-native-shim.ts";

const NO_ORPHANS_PROBE = [
  process.execPath,
  "-e",
  "process.exit(process.env.BUN_FEATURE_FLAG_NO_ORPHANS === '1' ? 0 : 1)",
];

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

  describe("bun-native-shim-spawn-env", () => {
    test("execFileSync passes no-orphans env to child", () => {
      if (process.platform === "win32") return;
      expect(() => execFileSync(process.execPath, NO_ORPHANS_PROBE.slice(1))).not.toThrow();
    });

    test("spawnQuiet passes no-orphans env to child", () => {
      if (process.platform === "win32") return;
      expect(spawnQuiet(NO_ORPHANS_PROBE)).toBe(true);
    });

    test("spawnInherit passes no-orphans env to child", () => {
      if (process.platform === "win32") return;
      expect(() => spawnInherit(NO_ORPHANS_PROBE)).not.toThrow();
    });
  });
});
