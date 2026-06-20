import { Effect } from "effect";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCapabilityAggregator, readCapabilityTrend } from "../src/lib/capabilities.ts";
import { readDecisionLedger } from "../src/lib/decision-ledger.ts";

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
      const report = await Effect.runPromise(runCapabilityAggregator(dir));
      const trend = await readCapabilityTrend();

      expect(report.checks.map((check) => check.id)).toContain("mcp-config");
      expect(report.checks.map((check) => check.id)).toContain("contract-trust");
      expect(report.readiness).toBe(report.readinessScore);
      expect(report.readinessScore).toBeGreaterThanOrEqual(50);
      expect(trend.snapshots.length).toBeGreaterThan(0);

      const ledger = await readDecisionLedger();
      expect(
        ledger.some(
          (entry) =>
            entry.key === "capability-degrade:credential-provider-env" &&
            (entry.rationale.evidence ?? []).some(
              (evidence) => evidence.capabilityItem === "credential-provider-env"
            )
        )
      ).toBe(true);
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
