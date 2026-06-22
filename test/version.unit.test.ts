import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  isVersionAtLeast,
  formatVersionTable,
  semverSatisfies,
  isValidSemver,
  semverOrderLabel,
  versionBelow,
} from "../src/lib/version.ts";

describe("version", () => {
  test("compareVersions returns -1, 0, 1", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("compareVersions handles pre-release tags", () => {
    expect(compareVersions("0.18.0-canary.1", "0.18.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
  });

  test("semverSatisfies checks ranges", () => {
    expect(semverSatisfies("1.5.0", ">=1.0.0")).toBe(true);
    expect(semverSatisfies("0.9.0", ">=1.0.0")).toBe(false);
  });

  test("isValidSemver validates semver strings", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("0.18.0-canary.1")).toBe(true);
    expect(isValidSemver("garbage")).toBe(false);
  });

  test("semverOrderLabel maps compareVersions to labels", () => {
    expect(semverOrderLabel("1.0.0", "1.0.0")).toBe("equal");
    expect(semverOrderLabel("2.0.0", "1.0.0")).toBe("a > b");
    expect(semverOrderLabel("1.0.0", "2.0.0")).toBe("a < b");
  });

  test("versionBelow safe for null", () => {
    expect(versionBelow(null, "1.0.0")).toBe(true);
    expect(versionBelow("0.9.0", "1.0.0")).toBe(true);
    expect(versionBelow("2.0.0", "1.0.0")).toBe(false);
  });

  test("isVersionAtLeast uses toolchain version", () => {
    expect(isVersionAtLeast("0.0.0")).toBe(true);
    expect(isVersionAtLeast("99.99.99")).toBe(false);
  });

  test("version.ts avoids node:fs/promises for atomic manifest writes", async () => {
    const text = await Bun.file(new URL("../src/lib/version.ts", import.meta.url)).text();
    expect(text).not.toContain('from "node:fs/promises"');
    expect(text).toContain("movePath");
  });

  test("formatVersionTable returns string with headers", () => {
    const table = formatVersionTable({
      toolchain: "1.0.0",
      name: "kimi-toolchain",
      mcpBridge: "1.0.0",
      desktop: null,
      gitHead: "abc123",
      dirty: false,
      manifestPath: "/tmp/manifest.json",
    });
    expect(table).toContain("Toolchain");
    expect(table).toContain("1.0.0");
  });
});
