import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ERROR_COVERAGE_TARGET,
  SUCCESS_METRIC_THRESHOLDS,
  auditErrorCoverage,
  auditSuccessMetrics,
  buildProviderAgilityFixture,
  metricThresholdEvidenceComplete,
  readFailureLedgerSummary,
} from "../src/lib/success-metrics.ts";
import { loadTaxonomy } from "../src/lib/error-taxonomy.ts";
import { isTwoArtifactProviderIntegration } from "../src/lib/provider-contract.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("success-metrics", () => {
  test("managed failure fixtures meet taxonomy coverage target", async () => {
    const taxonomy = await loadTaxonomy(join(REPO_ROOT, "error-taxonomy.yml"));
    const coverage = auditErrorCoverage(taxonomy);
    expect(coverage.coverage).toBeGreaterThanOrEqual(ERROR_COVERAGE_TARGET);
    expect(coverage.records[0].context?.inputs).toBeDefined();
    expect(coverage.records[0].context?.environment).toBeDefined();
  });

  test("metric thresholds include release cadence and ledger evidence", () => {
    expect(ERROR_COVERAGE_TARGET).toBe(SUCCESS_METRIC_THRESHOLDS.errorCoverage.value);
    expect(SUCCESS_METRIC_THRESHOLDS.errorCoverage.releaseCadence).toBe("toolchain-release");
    expect(SUCCESS_METRIC_THRESHOLDS.errorCoverage.ledgerEvidence.source).toContain(
      "tool-failures.jsonl"
    );
    expect(metricThresholdEvidenceComplete()).toBe(true);
  });

  test("failure ledger summary only returns counts", async () => {
    const dir = join(tmpdir(), `kimi-ledger-${Bun.randomUUIDv7()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "tool-failures.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ taxonomyId: "lockfile_issue", output: "secret-ish detail" }),
        JSON.stringify({ categoryId: "unknown", output: "raw output" }),
        "not-json",
      ].join("\n")
    );

    const summary = await readFailureLedgerSummary(path);
    expect(summary.total).toBe(2);
    expect(summary.taxonomyCounts.lockfile_issue).toBe(1);
    expect(summary.unclassified).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("secret-ish detail");
    rmSync(dir, { recursive: true, force: true });
  });

  test("provider agility fixture uses exactly two artifacts", () => {
    const integration = buildProviderAgilityFixture();
    expect(isTwoArtifactProviderIntegration(integration)).toBe(true);
    expect(integration.contract.permissions.length).toBeGreaterThan(0);
    expect(integration.credentialAdapter.secretScope).toBe("cloudflare-access");
  });

  test.skipIf(Bun.env.KIMI_TEST_CHANGED_PARALLEL === "1")(
    "repo success metrics audit passes",
    async () => {
      const report = await auditSuccessMetrics(REPO_ROOT);
      expect(report.checks.every((check) => check.status === "ok")).toBe(true);
    }
  );
});
