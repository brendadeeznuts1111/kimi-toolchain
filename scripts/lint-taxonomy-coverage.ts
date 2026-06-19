#!/usr/bin/env bun
/**
 * Report taxonomy categories missing boundConstants linkage.
 */

import { join } from "path";
import { auditTaxonomyCoverage } from "../src/lib/taxonomy-coverage.ts";

const ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const strict = Bun.argv.includes("--strict");
  const report = await auditTaxonomyCoverage(ROOT);
  if (!report.applicable) {
    console.log("lint:taxonomy-coverage skipped (no error-taxonomy.yml)");
    return;
  }

  for (const row of report.rows) {
    const icon = row.status === "ok" ? "✓" : "✗";
    console.log(`${icon} ${row.message}`);
  }

  if (!report.aligned) {
    const count = report.rows.filter((row) => row.status === "warn").length;
    if (strict) {
      console.error(`lint:taxonomy-coverage failed (${count} unlinked)`);
      process.exit(1);
    }
    console.log(`lint:taxonomy-coverage advisory (${count} unlinked — run with --strict to fail)`);
    return;
  }

  console.log("lint:taxonomy-coverage OK");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      "lint:taxonomy-coverage failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  });
}
