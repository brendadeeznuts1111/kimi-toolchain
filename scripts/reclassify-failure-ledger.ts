#!/usr/bin/env bun
/**
 * Reclassify unknown failures in ~/.kimi-code/var/tool-failures.jsonl
 * using the current taxonomy. Useful after adding new patterns.
 *
 * Usage:
 *   bun run scripts/reclassify-failure-ledger.ts
 *   bun run scripts/reclassify-failure-ledger.ts --dry-run
 *   bun run scripts/reclassify-failure-ledger.ts --json
 */

import {
  classifyFailure,
  loadTaxonomy,
  reconstructFailureOutput,
} from "../src/lib/error-taxonomy.ts";
import { failureLedgerPath } from "../src/lib/paths.ts";
import { safeParse } from "../src/lib/utils.ts";

interface FailureRecord {
  schemaVersion: number;
  timestamp: string;
  toolName: string;
  output: string;
  taxonomyId?: string;
  categoryId?: string;
  categoryName?: string;
  severity?: string;
  expected?: boolean;
  suggestion?: string;
  autoFix?: string;
  matchedPattern?: string;
  errorId: string;
  context?: {
    stack?: string;
    inputs?: Record<string, unknown>;
    environment?: Record<string, string>;
  };
  [key: string]: unknown;
}

export interface ReclassifyReport {
  total: number;
  reclassified: number;
  unchanged: number;
  byTarget: Record<string, number>;
}

export function reclassifyFailureRecords(
  records: FailureRecord[],
  taxonomy: Awaited<ReturnType<typeof loadTaxonomy>>
): { updated: FailureRecord[]; report: ReclassifyReport } {
  let reclassified = 0;
  let unchanged = 0;
  const byTarget: Record<string, number> = {};
  const updated: FailureRecord[] = [];

  for (const record of records) {
    if (record.taxonomyId && record.taxonomyId !== "unknown") {
      updated.push(record);
      unchanged++;
      continue;
    }

    const output = reconstructFailureOutput(record);
    const match = classifyFailure(output, taxonomy);
    if (match.category.id === "unknown" || match.category.id === record.taxonomyId) {
      updated.push(record);
      unchanged++;
      continue;
    }

    const category = match.category;
    updated.push({
      ...record,
      taxonomyId: category.id,
      categoryId: category.id,
      categoryName: category.name,
      severity: category.severity,
      expected: category.expected,
      suggestion: category.suggestion,
      autoFix: category.autoFix,
      matchedPattern: match.matchedPattern,
    });
    reclassified++;
    byTarget[category.id] = (byTarget[category.id] || 0) + 1;
  }

  return {
    updated,
    report: {
      total: records.length,
      reclassified,
      unchanged,
      byTarget,
    },
  };
}

async function main(): Promise<number> {
  const dryRun = Bun.argv.includes("--dry-run");
  const json = Bun.argv.includes("--json");
  const taxonomy = await loadTaxonomy();
  const ledgerPath = failureLedgerPath();

  if (!(await Bun.file(ledgerPath).exists())) {
    console.error("Failure ledger not found:", ledgerPath);
    return 1;
  }

  const text = await Bun.file(ledgerPath).text();
  const lines = text.trim().split("\n").filter(Boolean);
  const records = lines
    .map((line) => safeParse<FailureRecord | null>(line, null))
    .filter((r): r is FailureRecord => r !== null);

  const { updated, report } = reclassifyFailureRecords(records, taxonomy);

  if (json) {
    console.log(JSON.stringify({ ...report, ledgerPath, dryRun }, null, 2));
  } else {
    console.log(`Total records: ${report.total}`);
    console.log(`Reclassified:  ${report.reclassified}`);
    console.log(`Unchanged:     ${report.unchanged}`);
    if (Object.keys(report.byTarget).length > 0) {
      console.log("By target:");
      for (const [id, count] of Object.entries(report.byTarget).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${id}: ${count}`);
      }
    }
  }

  if (dryRun) {
    if (!json) console.log("Dry run — no changes written.");
    return 0;
  }

  if (report.reclassified === 0) {
    if (!json) console.log("No reclassifications needed.");
    return 0;
  }

  const out = updated.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await Bun.write(ledgerPath, out);
  if (!json) console.log(`Wrote ${updated.length} records to ${ledgerPath}`);
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("reclassify failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
