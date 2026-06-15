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

const REPO_ROOT = join(import.meta.dir, "..");

describe("success-metrics", () => {
  test("managed failure fixtures meet taxonomy coverage target", async () => {
    const taxonomy = await loadTaxonomy(join(REPO_ROOT, "error-taxonomy.yml"));
    const coverage = auditErrorCoverage(taxonomy);
    expect(coverage.coverage).toBeGreaterThanOrEqual(ERROR_COVERAGE_TARGET);
    expect(coverage.coverage).toBe(1);
    expect(coverage.unclassified).toEqual([]);
    expect(coverage.records.map((record) => record.taxonomyId)).toContain("mcp_config_missing");
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
        JSON.stringify({
          categoryId: "unknown",
          toolName: "kimi-doctor",
          output: "raw output",
          timestamp: "2026-06-15T01:00:00.000Z",
        }),
        JSON.stringify({
          taxonomyId: "unknown",
          toolName: "kimi-doctor",
          output: "raw output",
          timestamp: "2026-06-15T02:00:00.000Z",
        }),
        "not-json",
      ].join("\n")
    );

    const summary = await readFailureLedgerSummary(path);
    expect(summary.total).toBe(4);
    expect(summary.taxonomyCounts.lockfile_issue).toBe(1);
    expect(summary.unclassified).toBe(3);
    expect(summary.reviewCommand).toBe(`kimi-debug ledger ${path}`);
    expect(summary.unknownAction).toContain("error-taxonomy.yml");
    expect(summary.unknownBuckets).toHaveLength(2);
    expect(summary.unknownBuckets[0]).toMatchObject({
      count: 2,
      toolNames: ["kimi-doctor"],
      firstSeen: "2026-06-15T01:00:00.000Z",
      lastSeen: "2026-06-15T02:00:00.000Z",
    });
    expect(summary.unknownBuckets[0]?.fingerprint).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(summary.unknownBuckets[1]).toMatchObject({
      fingerprint: "malformed-json",
      count: 1,
      toolNames: ["ledger-parser"],
    });
    expect(JSON.stringify(summary)).not.toContain("secret-ish detail");
    expect(JSON.stringify(summary)).not.toContain("raw output");
    rmSync(dir, { recursive: true, force: true });
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
