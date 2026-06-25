import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  appendDashboardHttpAudit,
  buildDashboardLogEntry,
  isDashboardProbeRequest,
  levelForStatus,
  resetDashboardLogPath,
  setDashboardLogPath,
} from "../src/lib/dashboard-http-audit.ts";
import { DASHBOARD_PROBE_HEADER } from "../src/lib/dashboard-card-registry.ts";
import { readText } from "../src/lib/bun-io.ts";
import { testTempDir } from "./helpers.ts";

describe("dashboard-http-audit", () => {
  test("levelForStatus maps HTTP codes", () => {
    expect(levelForStatus(200)).toBe("info");
    expect(levelForStatus(404)).toBe("warn");
    expect(levelForStatus(500)).toBe("error");
  });

  test("isDashboardProbeRequest detects query and probe header", () => {
    const withQuery = new Request("http://127.0.0.1:5678/api/cards?probe=true");
    expect(isDashboardProbeRequest(withQuery, new URL(withQuery.url))).toBe(true);

    const withHeader = new Request("http://127.0.0.1:5678/api/image", {
      headers: { [DASHBOARD_PROBE_HEADER]: "1" },
    });
    expect(isDashboardProbeRequest(withHeader, new URL(withHeader.url))).toBe(true);

    const plain = new Request("http://127.0.0.1:5678/api/settings");
    expect(isDashboardProbeRequest(plain, new URL(plain.url))).toBe(false);
  });

  test("appendDashboardHttpAudit appends JSONL with schemaVersion", () => {
    const dir = testTempDir("dashboard-http-audit");
    const logPath = join(dir, "events.jsonl");
    setDashboardLogPath(logPath);

    appendDashboardHttpAudit(
      buildDashboardLogEntry({
        ts: 1,
        level: "info",
        route: "/api/health",
        method: "GET",
        status: 200,
        durationMs: 0.5,
      })
    );

    const line = readText(logPath).trim();
    const parsed = JSON.parse(line) as { schemaVersion: number; route: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.route).toBe("/api/health");

    resetDashboardLogPath();
  });
});