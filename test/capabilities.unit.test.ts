import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { capabilityReport, readCapabilityTrend } from "../src/lib/capabilities.ts";

describe("capabilities", () => {
  test("aggregates checks and stores a snapshot", async () => {
    const dir = join(tmpdir(), `kimi-capabilities-${Bun.randomUUIDv7()}`);
    const oldHome = Bun.env.HOME;
    mkdirSync(join(dir, ".kimi-code"), { recursive: true });
    writeFileSync(
      join(dir, ".kimi-code", "mcp.json"),
      JSON.stringify({ mcpServers: { "unified-shell": { command: "bun" } } })
    );
    writeFileSync(
      join(dir, ".kimi-code", "config.toml"),
      '[[hooks]]\nevent = "PostToolUseFailure"\ncommand = "log-tool-failure"\n'
    );

    try {
      Bun.env.HOME = dir;
      const report = await capabilityReport(dir);
      const trend = await readCapabilityTrend();

      expect(report.checks.map((check) => check.id)).toContain("mcp-config");
      expect(report.checks.map((check) => check.id)).toContain("contract-trust");
      expect(report.readinessScore).toBeGreaterThanOrEqual(50);
      expect(trend.snapshots.length).toBeGreaterThan(0);
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
