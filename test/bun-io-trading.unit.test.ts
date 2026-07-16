import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { listDir, pathExists } from "../templates/modules/trading/src/trading/lib/bun-io.ts";
import { removePath, testTempDir } from "./helpers.ts";

describe("bun-io-trading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = testTempDir("bun-io-trading-");
  });

  afterEach(() => {
    removePath(tempDir, { recursive: true, force: true });
  });

  test("pathExists returns false for missing paths", () => {
    const missing = join(tempDir, "no-such-dir", "nested");
    expect(pathExists(missing)).toBe(false);
  });

  test("pathExists returns true for empty directories", () => {
    const empty = join(tempDir, "empty-artifacts");
    Bun.spawnSync({ cmd: ["mkdir", "-p", empty] });
    expect(pathExists(empty)).toBe(true);
    expect(listDir(empty)).toEqual([]);
  });

  test("pathExists returns true for files", () => {
    const file = join(tempDir, "artifact.json");
    Bun.write(file, "{}");
    expect(pathExists(file)).toBe(true);
  });
});
