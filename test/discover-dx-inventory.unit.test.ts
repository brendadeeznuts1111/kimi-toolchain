import { describe, expect, it } from "bun:test";
import { join } from "path";
import { discoverDxInventory } from "../src/lib/discover-dx-inventory.ts";
import { withTempDir, writeText } from "./helpers.ts";

describe("discover-dx-inventory", () => {
  it("detects duplicate endpoint URLs in a fixture config", async () => {
    await withTempDir("dx-dup-", async (dir) => {
      writeText(
        join(dir, "dx.config.toml"),
        `schemaVersion = 1\nname = "dup-test"\n\n[[endpoints]]\nname = "a"\nurl = "http://127.0.0.1:5678/api/cards"\n\n[[endpoints]]\nname = "b"\nurl = "http://127.0.0.1:5678/api/cards"\n`
      );
      const report = await discoverDxInventory(dir);
      expect(report.endpointCount).toBe(2);
      expect(report.uniqueUrlCount).toBe(1);
      expect(report.duplicateUrlGroups).toBe(1);
      const endpointA = report.endpoints.find((entry) => entry.name === "a");
      expect(endpointA?.duplicateNames).toContain("b");
      expect(report.gaps.some((gap) => gap.includes("duplicate endpoint URL"))).toBe(true);
    });
  });

  it("should discover endpoints, rules, gates, and probe coverage from dx.config.toml", async () => {
    const root = join(import.meta.dir, "..");
    const report = await discoverDxInventory(root);

    expect(report.endpointCount).toBe(9);
    expect(report.uniqueUrlCount).toBe(9);
    expect(report.duplicateUrlGroups).toBe(0);
    expect(report.handoffRuleCount).toBe(2);
    expect(report.finishWorkGateCount).toBe(5);
    expect(report.remoteHostCount).toBe(1);
    expect(report.availableProbeCount).toBe(9);
    expect(report.configuredProbeCount).toBe(2);
    expect(report.orchestrator.enabled).toBe(true);
    expect(report.healthScore).toBeGreaterThan(0);
    expect(report.registeredTomlTables).toContain("herdr.orchestrator.handoff_rules");
    expect(report.portAlignment.dashboardPort).toBe(5678);

    const handoffReady = report.handoffRules.find((rule) =>
      rule.probeIds.includes("finish-work:handoff-ready")
    );
    expect(handoffReady?.when).toContain("finishWorkReport.review.resolved=true");
    expect(handoffReady?.when).toContain('pane.status="idle"');
    expect(handoffReady?.requirements.length).toBeGreaterThan(1);

    const canonical = report.probeCoverage.find(
      (entry) => entry.id === "canonical-references:runtime-aligned"
    );
    expect(canonical?.configured).toBe(true);
    expect(canonical?.ruleIndexes).toEqual([2]);

    expect(report.gaps.some((gap) => gap.includes("duplicate endpoint URL"))).toBe(false);
    expect(report.gaps.some((gap) => gap.includes('remote host "staging"'))).toBe(true);
  });
});
