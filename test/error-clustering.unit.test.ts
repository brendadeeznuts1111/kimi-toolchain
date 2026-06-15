import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clusterFailureLedger, matchErrorToClusters } from "../src/lib/error-clustering.ts";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-cluster-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("error-clustering", () => {
  test("groups semantically similar timeout failures", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        [
          JSON.stringify({
            toolName: "unified-shell",
            output: "Tool timed out after 30000ms while running bun test",
            taxonomyId: "timeout",
            suggestion: "Increase timeout or reduce subprocess work.",
          }),
          JSON.stringify({
            toolName: "kimi-doctor",
            output: "timeout waiting for tool after 15000ms",
            taxonomyId: "timeout",
          }),
          JSON.stringify({
            toolName: "kimi-guardian",
            output: "HASH MISMATCH for bun.lock",
            taxonomyId: "lockfile_issue",
          }),
        ].join("\n")
      );

      const report = await clusterFailureLedger({
        failurePath,
        tracePath: join(dir, "trace-events.jsonl"),
        threshold: 0.12,
      });

      expect(report.totalFailures).toBe(3);
      expect(report.clusters.some((cluster) => cluster.size >= 2)).toBe(true);
      const match = matchErrorToClusters("command timed out after 20000ms", report.clusters);
      expect(match?.cluster.taxonomyCounts.timeout).toBeGreaterThanOrEqual(1);
      expect(match?.confidence).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
