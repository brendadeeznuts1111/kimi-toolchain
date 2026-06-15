import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyHealPlan, buildHealPlan, type HealPlan } from "../src/lib/self-healing.ts";
import type { CapabilityReport } from "../src/lib/capabilities.ts";
import type { ErrorClusterReport } from "../src/lib/error-clustering.ts";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-heal-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function capabilities(checks: CapabilityReport["checks"]): CapabilityReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    readinessScore: 0,
    healthy: 0,
    degraded: checks.filter((check) => check.status === "degraded").length,
    unavailable: checks.filter((check) => check.status === "unavailable").length,
    checks,
  };
}

function clusters(clusters: ErrorClusterReport["clusters"]): ErrorClusterReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    threshold: 0.42,
    totalFailures: clusters.reduce((sum, cluster) => sum + cluster.size, 0),
    clusters,
  };
}

describe("self-healing", () => {
  test("surfaces safe capability repairs and manual cluster actions", async () => {
    const dir = tempDir();
    try {
      const plan = await buildHealPlan(dir, {
        capabilities: capabilities([
          {
            id: "mcp-config",
            type: "mcp",
            status: "degraded",
            summary: "MCP config present without unified-shell",
            latencyMs: 2,
          },
        ]),
        clusters: clusters([
          {
            id: "cluster-lockfile",
            label: "guardian lockfile hash mismatch",
            size: 2,
            confidence: 0.9,
            taxonomyCounts: { lockfile_issue: 2 },
            tools: ["kimi-guardian"],
            members: [
              {
                traceId: "trace-lock",
                toolName: "kimi-guardian",
                taxonomyId: "lockfile_issue",
                output: "HASH MISMATCH for bun.lock",
                similarity: 1,
              },
            ],
          },
        ]),
      });

      const mcp = plan.actions.find((action) => action.id === "capability:mcp-config:doctor-fix");
      const lockfile = plan.actions.find((action) => action.id.includes("lockfile_issue"));

      expect(mcp?.safeToAutoApply).toBe(true);
      expect(mcp?.command).toEqual(["bun", "run", "doctor", "--fix", "--quick"]);
      expect(lockfile?.safeToAutoApply).toBe(false);
      expect(lockfile?.status).toBe("manual");
      expect(plan.summary.autoApplicable).toBe(1);
      expect(plan.summary.manual).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps apply dry-run by default", async () => {
    const dir = tempDir();
    try {
      const plan: HealPlan = {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        projectRoot: dir,
        actions: [
          {
            id: "capability:mcp-config:doctor-fix",
            title: "Repair MCP config registration",
            source: "capability",
            reason: "MCP config missing",
            confidence: 0.94,
            command: ["bun", "--version"],
            safeToAutoApply: true,
            status: "available",
          },
        ],
        summary: {
          total: 1,
          autoApplicable: 1,
          manual: 0,
          blocked: 0,
        },
      };

      const report = await applyHealPlan(plan);

      expect(report.dryRun).toBe(true);
      expect(report.applied[0]?.status).toBe("dry-run");
      expect(report.summary.attempted).toBe(0);
      expect(report.summary.skipped).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("surfaces runtime sync when the ledger contains object stringification", async () => {
    const dir = tempDir();
    try {
      const plan = await buildHealPlan(dir, {
        capabilities: capabilities([]),
        clusters: clusters([
          {
            id: "cluster-object",
            label: "object serialization",
            size: 1,
            confidence: 1,
            taxonomyCounts: { unknown: 1 },
            tools: ["Edit"],
            members: [
              {
                toolName: "Edit",
                taxonomyId: "unknown",
                output: "[object Object]",
                similarity: 1,
              },
            ],
          },
        ]),
      });

      const action = plan.actions.find((item) => item.command?.join(" ") === "bun run sync");

      expect(action?.safeToAutoApply).toBe(true);
      expect(action?.status).toBe("available");
      expect(action?.title).toContain("failure hook");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
