import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { cleanupPath, REPO_ROOT, testTempDir } from "./helpers.ts";

const ERROR_CLI = join(REPO_ROOT, "src/bin/kimi-error.ts");

describe("error-clustering", () => {
  test("cluster --json returns non-empty summaries for seeded ledger", async () => {
    const home = testTempDir("kimi-error-cli-");
    try {
      makeDir(join(home, ".kimi-code", "var"), { recursive: true });
      const failurePath = join(home, ".kimi-code", "var", "tool-failures.jsonl");
      writeText(
        failurePath,
        [
          JSON.stringify({
            errorId: "error-seed-1",
            toolName: "unified-shell",
            output: "Tool timed out after 30000ms",
            taxonomyId: "timeout",
          }),
          JSON.stringify({
            errorId: "error-seed-2",
            toolName: "kimi-doctor",
            output: "timeout waiting for tool after 15000ms",
            taxonomyId: "timeout",
          }),
          JSON.stringify({
            errorId: "error-seed-3",
            toolName: "kimi-guardian",
            output: "lockfile hash mismatch",
            taxonomyId: "lockfile_issue",
          }),
        ].join("\n")
      );

      const proc = Bun.spawn(
        ["bun", "run", ERROR_CLI, "cluster", "--json", "--threshold", "0.35"],
        {
          env: { ...Bun.env, HOME: home },
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const stdout = proc.stdout ? await Bun.readableStreamToText(proc.stdout) : "";
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const summaries = JSON.parse(stdout);
      expect(Array.isArray(summaries)).toBe(true);
      expect(summaries.length).toBeGreaterThan(0);
      expect(summaries.some((row: { count: number }) => row.count >= 2)).toBe(true);
      expect(summaries[0]).toHaveProperty("clusterId");
      expect(summaries[0]).toHaveProperty("representativeError");
      expect(summaries[0]).toHaveProperty("hasPlaybook");
    } finally {
      cleanupPath(home);
    }
  });
});
