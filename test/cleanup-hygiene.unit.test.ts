import { describe, expect, test } from "bun:test";
import {
  hygieneExitCode,
  parseHygieneArgs,
  summarizeHygieneOutcome,
  type HygieneCleanupOutcome,
} from "../src/lib/cleanup-hygiene.ts";
import type { PathHygieneReport } from "../src/lib/path-hygiene.ts";

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

  test("--fix is alias for --fix-bunfig", () => {
    expect(parseHygieneArgs(["all", "--fix"]).fixBunfig).toBe(true);
  });

  test("--deep sets deep flag", () => {
    expect(parseHygieneArgs(["all", "--deep"]).deep).toBe(true);
  });

  test("summarizeHygieneOutcome marks dirty when items exist", () => {
    const report: PathHygieneReport = {
      schemaVersion: 1,
      scanRoot: "/tmp",
      dryRun: true,
      maxDepth: 6,
      kinds: ["test-bun-artifact"],
      items: [
        {
          relPath: "test-bun-x",
          kind: "test-bun-artifact",
          bytes: 100,
          fileCount: 1,
          cause: "probe",
          absolutePath: "/tmp/test-bun-x",
        },
      ],
      totalBytes: 100,
      totalFiles: 1,
      misconfig: [],
    };
    const outcome: HygieneCleanupOutcome = {
      type: "path",
      dryRun: true,
      json: false,
      reports: [report],
    };
    const summary = summarizeHygieneOutcome(outcome);
    expect(summary?.dirty).toBe(true);
    expect(summary?.itemGroups).toBe(1);
    expect(hygieneExitCode(outcome)).toBe(1);
  });

  test("hygieneExitCode is 0 when clean", () => {
    const outcome: HygieneCleanupOutcome = {
      type: "root",
      dryRun: true,
      json: false,
      report: {
        projectRoot: "/tmp",
        dryRun: true,
        items: [],
        totalBytes: 0,
        totalFiles: 0,
        misconfig: [],
      },
      bunfigFixed: false,
    };
    expect(hygieneExitCode(outcome)).toBe(0);
  });
});
