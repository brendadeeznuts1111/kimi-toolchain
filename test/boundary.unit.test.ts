import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { isPlainObject, isStringArray, isStringRecord, recordField } from "../src/lib/boundary.ts";
import { parseJsonValue, readJsonFileOr, tryReadJsonValidated } from "../src/lib/bun-io.ts";
import { isSnapshot } from "../src/lib/snapshot-core.ts";
import { parseTomlValue } from "../src/lib/toml-config.ts";

describe("boundary", () => {
  test("recordField and isPlainObject", () => {
    expect(recordField({ a: 1 }, "a")).toBe(1);
    expect(recordField(null, "a")).toBeUndefined();
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
  });

  test("isStringArray and isStringRecord", () => {
    expect(isStringArray(["a"])).toBe(true);
    expect(isStringArray([1])).toBe(false);
    expect(isStringRecord({ k: "v" })).toBe(true);
    expect(isStringRecord({ k: 1 })).toBe(false);
  });

  describe("bun-io json boundary", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "boundary-io-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    test("parseJsonValue throws on invalid shape", () => {
      expect(() => parseJsonValue({}, isStringArray, "test")).toThrow(/Invalid test/);
    });

    test("readJsonFileOr returns fallback for invalid file", async () => {
      const path = join(tempDir, "bad.json");
      await Bun.write(path, JSON.stringify({ not: "snapshot" }));
      const result = await readJsonFileOr(path, null, isSnapshot);
      expect(result).toBeNull();
    });

    test("tryReadJsonValidated reads valid snapshot", async () => {
      const path = join(tempDir, "snap.json");
      const snap = {
        id: "snap-1",
        project: "demo",
        projectPath: "/tmp/demo",
        createdAt: "2026-01-01T00:00:00.000Z",
        branch: "main",
        commit: "abc123",
        untrackedFiles: [],
        modifiedFiles: ["a.ts"],
        envVars: { PORT: "3000" },
        description: "test",
      };
      await Bun.write(path, JSON.stringify(snap));
      const parsed = await tryReadJsonValidated(path, isSnapshot);
      expect(parsed?.id).toBe("snap-1");
    });
  });

  describe("toml-config parseTomlValue", () => {
    test("returns plain object for valid TOML table", () => {
      const parsed = parseTomlValue('[install]\nregistry = "https://registry.npmjs.org"');
      expect(isPlainObject(parsed)).toBe(true);
      const install = recordField(parsed, "install");
      expect(isPlainObject(install)).toBe(true);
      expect(recordField(install, "registry")).toBe("https://registry.npmjs.org");
    });

    test("returns null for invalid TOML", () => {
      expect(parseTomlValue("[[broken")).toBeNull();
    });
  });
});
