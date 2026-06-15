import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildHealPlan } from "../src/lib/self-healing.ts";
import { clusterFailureLedger } from "../src/lib/error-clustering.ts";
import { writeFileSync } from "fs";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-heal-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("self-healing", () => {
  test("buildHealPlan surfaces cluster playbook actions", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        [
          JSON.stringify({
            errorId: "error-heal-1",
            traceId: "trace-lock",
            toolName: "kimi-guardian",
            output: "HASH MISMATCH for bun.lock",
            taxonomyId: "lockfile_issue",
          }),
        ].join("\n")
      );

      const clusters = await clusterFailureLedger({
        failurePath,
        tracePath: join(dir, "trace-events.jsonl"),
        clustersPath: join(dir, "error-clusters.json"),
        threshold: 0.35,
      });

      const plan = await buildHealPlan(dir, {
        clusters,
        capabilities: {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          readiness: 100,
          readinessScore: 100,
          healthy: 0,
          degraded: 0,
          unavailable: 0,
          checks: [],
        },
      });
      const clusterAction = plan.actions.find((action) => action.source === "cluster");
      expect(clusterAction).toBeTruthy();
      expect(clusterAction?.metadata?.clusterId).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
