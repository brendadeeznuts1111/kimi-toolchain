import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "../helpers.ts";
import { invokeTool } from "../../src/lib/tool-runner.ts";

const CONFIG_STATUS = join(REPO_ROOT, "scripts/config-status.ts");

describe("config-status smoke", () => {
  test("config:status --json reports aligned configuration layers", async () => {
    const result = await invokeTool(CONFIG_STATUS, ["--json"], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    const report = JSON.parse(result.stdout.trim()) as {
      schemaVersion: number;
      tool: string;
      aligned: boolean;
      gates: Array<{ id: string; layer: string; status: string; ms: number }>;
      fixPlan: string[];
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("config-status");
    expect(report.aligned).toBe(true);
    expect(report.gates.length).toBeGreaterThanOrEqual(3);
    for (const gate of report.gates) {
      expect(gate.status).toBe("pass");
    }
    expect(report.fixPlan).toEqual([]);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  test("config:status prints human-readable table", async () => {
    const result = await invokeTool(CONFIG_STATUS, [], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(result.stdout).toContain("Configuration layers status");
    expect(result.stdout).toContain("canonical-references");
    expect(result.stdout).toContain("constants-manifest");
    expect(result.stdout).toContain("constant-parity");
    expect(result.exitCode).toBe(0);
  }, 15_000);
});
