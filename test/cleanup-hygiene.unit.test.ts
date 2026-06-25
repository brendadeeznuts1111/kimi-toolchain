import { describe, expect, test } from "bun:test";
import { parseHygieneArgs } from "../src/lib/cleanup-hygiene.ts";

describe("cleanup-hygiene CLI", () => {
  test("defaults to path mode", () => {
    const opts = parseHygieneArgs([]);
    expect(opts.mode).toBe("path");
    expect(opts.dryRun).toBe(false);
    expect(opts.paths).toEqual([]);
  });

  test("parses explicit modes and flags", () => {
    const opts = parseHygieneArgs([
      "all",
      "--dry-run",
      "--path",
      "~/Projects",
      "--root",
      "/tmp/repo",
      "--fix-bunfig",
    ]);
    expect(opts.mode).toBe("all");
    expect(opts.dryRun).toBe(true);
    expect(opts.paths).toEqual(["~/Projects"]);
    expect(opts.root).toBe("/tmp/repo");
    expect(opts.fixBunfig).toBe(true);
  });

  test("rejects unknown options", () => {
    expect(() => parseHygieneArgs(["path", "--nope"])).toThrow("Unknown option");
  });
});
