#!/usr/bin/env bun
/**
 * lint-context-bloat.ts — Agent-facing doc hygiene gate.
 *
 * Catches broken internal links, stale moved doc paths, CONTEXT.md placeholders,
 * orphan docs/, oversized AGENTS/CONTEXT, duplicate template placeholders,
 * AGENTS.md / package.json bin count drift, scaffold templates, and git-tracked *.bak.
 */

import { join } from "path";
import { auditContextBloat, formatContextBloatReport } from "../src/lib/context-bloat-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");

async function main(): Promise<number> {
  const issues = await auditContextBloat(REPO_ROOT);
  const errors = issues.filter((i) => i.severity === "error");

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-context-bloat",
        ok: errors.length === 0,
        issues,
      })
    );
    return errors.length === 0 ? 0 : 1;
  }

  console.log(formatContextBloatReport(issues));
  return errors.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
