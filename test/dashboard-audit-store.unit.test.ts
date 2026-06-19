import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import {
  closeAuditStore,
  dashboardEventTimestamp,
  queryDashboardEvents,
  writeDashboardEvent,
} from "../src/lib/dashboard-audit-store.ts";
import { cleanupPath, withIsolatedHome } from "./helpers.ts";

describe("dashboard-audit-store", () => {
  test("queryDashboardEvents enriches rows and filters by agent severity and text", async () => {
    await withIsolatedHome(async (home) => {
      const runtimeRoot = join(home, ".kimi-code");
      makeDir(join(runtimeRoot, "var"), { recursive: true });
      closeAuditStore();

      try {
        writeDashboardEvent({
          type: "herdr.event",
          workspace: "workspace-a",
          payload: {
            agentName: "Codex",
            severity: "warning",
            message: "OOM risk from pane restart",
            source: "watch-events",
          },
          at: dashboardEventTimestamp(),
        });
        writeDashboardEvent({
          type: "gate.cleared",
          workspace: "workspace-b",
          agent: "reviewer",
          payload: { ok: true, message: "healthy" },
          at: dashboardEventTimestamp(),
        });

        const result = queryDashboardEvents({
          agent: "codex",
          severity: "warn",
          q: "oom",
          limit: 10,
        });

        expect(result.ok).toBe(true);
        expect(result.count).toBe(1);
        expect(result.events[0]).toMatchObject({
          type: "herdr.event",
          workspace: "workspace-a",
          agent: "Codex",
          severity: "warn",
        });
        expect(result.events[0]?.payloadKeys).toContain("message");
        expect(result.events[0]?.tags).toContain("source:watch-events");
      } finally {
        closeAuditStore();
        cleanupPath(runtimeRoot);
      }
    });
  });
});
