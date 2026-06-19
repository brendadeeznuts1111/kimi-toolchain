import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import { fetchDashboardDebugLogs } from "../src/lib/herdr-dashboard-data.ts";
import { cleanupPath, testTempDir, withIsolatedHome, writeText } from "./helpers.ts";

describe("herdr-dashboard-data", () => {
  test("fetchDashboardDebugLogs keeps lines and adds structured entries", async () => {
    await withIsolatedHome(async (home) => {
      const projectRoot = testTempDir("dashboard-debug-logs-");
      const runtimeRoot = join(home, ".kimi-code");
      const varPath = join(runtimeRoot, "var");
      makeDir(varPath, { recursive: true });
      writeText(
        join(varPath, "tool-failures.jsonl"),
        [
          "2026-06-19T00:00:00Z info: booted",
          '2026-06-19T00:00:01Z {"level":"error","message":"gate failed"}',
          "2026-06-19T00:00:02Z warning: memory high",
        ].join("\n")
      );

      try {
        const payload = await fetchDashboardDebugLogs(projectRoot, "tool-failures", 2);

        expect(payload.ok).toBe(true);
        expect(payload.lines).toEqual([
          '2026-06-19T00:00:01Z {"level":"error","message":"gate failed"}',
          "2026-06-19T00:00:02Z warning: memory high",
        ]);
        expect(payload.entries).toEqual([
          {
            lineNumber: 2,
            severity: "error",
            message: "gate failed",
            raw: '2026-06-19T00:00:01Z {"level":"error","message":"gate failed"}',
          },
          {
            lineNumber: 3,
            severity: "warn",
            message: "memory high",
            raw: "2026-06-19T00:00:02Z warning: memory high",
          },
        ]);
      } finally {
        cleanupPath(projectRoot);
        cleanupPath(runtimeRoot);
      }
    });
  });
});
