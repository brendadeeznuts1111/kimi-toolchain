import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  ERROR_COVERAGE_TARGET,
  auditErrorCoverage,
  auditSuccessMetrics,
  buildProviderAgilityFixture,
} from "../src/lib/success-metrics.ts";
import { loadTaxonomy } from "../src/lib/error-taxonomy.ts";
import { isTwoArtifactProviderIntegration } from "../src/lib/provider-contract.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("success-metrics", () => {
  test("managed failure fixtures meet taxonomy coverage target", async () => {
    const taxonomy = await loadTaxonomy(join(REPO_ROOT, "error-taxonomy.yml"));
    const coverage = auditErrorCoverage(taxonomy);
    expect(coverage.coverage).toBeGreaterThanOrEqual(ERROR_COVERAGE_TARGET);
    expect(coverage.records[0].context?.inputs).toBeDefined();
    expect(coverage.records[0].context?.environment).toBeDefined();
  });

  test("provider agility fixture uses exactly two artifacts", () => {
    const integration = buildProviderAgilityFixture();
    expect(isTwoArtifactProviderIntegration(integration)).toBe(true);
    expect(integration.contract.permissions.length).toBeGreaterThan(0);
    expect(integration.credentialAdapter.secretScope).toBe("cloudflare-access");
  });

  test("repo success metrics audit passes", async () => {
    const report = await auditSuccessMetrics(REPO_ROOT);
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });
});
