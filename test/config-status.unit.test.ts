import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  auditConfigLayersStatus,
  formatConfigStatusTable,
  isConfigStatusReport,
} from "../src/lib/config-status.ts";
import { configStatusGateDefinition, runConfigStatusGate } from "../src/gates/config-status.ts";
import { getGate, listGates } from "../src/gates/registry.ts";

describe("config-status", () => {
  test("auditConfigLayersStatus passes all core gates in clean repo", async () => {
    const report = await auditConfigLayersStatus(REPO_ROOT);
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("config-status");
    expect(report.gates).toHaveLength(3);
    for (const gate of report.gates) {
      expect(gate.status).toBe("pass");
    }
    expect(report.aligned).toBe(true);
    expect(report.fixPlan).toHaveLength(0);
  }, 5_000);

  test("formatConfigStatusTable emits gate names and status markers", async () => {
    const report = await auditConfigLayersStatus(REPO_ROOT);
    const table = formatConfigStatusTable(report);
    expect(table).toContain("canonical-references");
    expect(table).toContain("constants-manifest");
    expect(table).toContain("constant-parity");
    expect(table).toContain("✅");
    expect(table).toContain("Configuration layers status");
  }, 5_000);

  test("isConfigStatusReport accepts valid report shape", async () => {
    const report = await auditConfigLayersStatus(REPO_ROOT);
    expect(isConfigStatusReport(report)).toBe(true);
    expect(isConfigStatusReport({ tool: "config-status" })).toBe(false);
  }, 5_000);

  test("config-status gate is registered", () => {
    expect(listGates()).toContain("config-status");
    const gate = getGate("config-status");
    expect(gate).toBeDefined();
    expect(gate?.name).toBe("config-status");
    expect(gate?.level).toBe(2);
  });

  test("runConfigStatusGate maps aligned report to pass", async () => {
    const result = await runConfigStatusGate({ projectRoot: REPO_ROOT });
    expect(result.status).toBe("pass");
    expect(result.report.tool).toBe("config-status");
    expect(result.report.aligned).toBe(true);
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.reason).toBeUndefined();
  }, 5_000);

  test("configStatusGateDefinition format includes gate summaries", async () => {
    const result = await runConfigStatusGate({ projectRoot: REPO_ROOT });
    const lines = configStatusGateDefinition.format!(result);
    expect(lines[0]).toContain("config-status");
    expect(lines[1]).toContain("canonical-references");
  });
});
