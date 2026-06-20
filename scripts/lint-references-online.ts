#!/usr/bin/env bun
/**
 * lint-references-online.ts — opt-in HEAD checks for ECOSYSTEM_REFERENCES URLs.
 *
 * Default: check homepage + docs (http/https only).
 * --json: machine-readable report for CI.
 *
 * Not part of `bun run check` — use in scheduled CI or manual drift audits.
 */

import {
  auditEcosystemReferenceUrlsOnline,
  collectEcosystemHttpUrls,
  formatEcosystemReferenceUrlReport,
} from "../src/lib/canonical-references.ts";

const json = Bun.argv.includes("--json");

async function main(): Promise<number> {
  const issues = await auditEcosystemReferenceUrlsOnline();
  const failures = issues.filter((i) => i.status === "fail");
  const skipped = issues.filter((i) => i.status === "skipped");
  const checked = issues.length - skipped.length;

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-references-online",
        ok: failures.length === 0,
        checked,
        skipped: skipped.length,
        urls: collectEcosystemHttpUrls().length,
        issues,
      })
    );
    return failures.length === 0 ? 0 : 1;
  }

  console.log(formatEcosystemReferenceUrlReport(issues));
  return failures.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
