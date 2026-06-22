import { describe, expect, test } from "bun:test";
import { formatVersionTable } from "../src/lib/version.ts";

describe("version", () => {
  test("Bun.semver.order returns -1, 0, 1", () => {
    expect(Bun.semver.order("1.0.0", "1.0.1")).toBe(-1);
    expect(Bun.semver.order("1.2.0", "1.1.9")).toBe(1);
    expect(Bun.semver.order("1.0.0", "1.0.0")).toBe(0);
  });

  test("Bun.semver.order handles pre-release tags", () => {
    expect(Bun.semver.order("0.18.0-canary.1", "0.18.0")).toBe(-1);
    expect(Bun.semver.order("1.0.0", "1.0.0-beta")).toBe(1);
  });

  test("Bun.semver.satisfies checks ranges", () => {
    expect(Bun.semver.satisfies("1.5.0", ">=1.0.0")).toBe(true);
    expect(Bun.semver.satisfies("0.9.0", ">=1.0.0")).toBe(false);
  });

  test("Bun.semver.order throws on invalid version for validation", () => {
    // Valid semver
    expect(() => Bun.semver.order("1.0.0", "0.0.0")).not.toThrow();
    expect(() => Bun.semver.order("0.18.0-canary.1", "0.0.0")).not.toThrow();
    // Invalid semver throws
    expect(() => Bun.semver.order("garbage", "0.0.0")).toThrow();
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
