#!/usr/bin/env bun
/**
 * lint-markdown-links.ts — Bun-native markdown dead-link gate.
 *
 * Default: agent docs, internal links only (offline).
 * --full: all docs markdown + skills SKILL.md files
 * --online: HEAD-check external https?:// links (warn on failure)
 */

import { join } from "path";
import {
  auditMarkdownDeadLinks,
  collectMarkdownLinkScanPaths,
  formatMarkdownDeadLinkReport,
} from "../src/lib/markdown-dead-links-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const online = Bun.argv.includes("--online");
const full = Bun.argv.includes("--full");
const json = Bun.argv.includes("--json");

async function main(): Promise<number> {
  const paths = await collectMarkdownLinkScanPaths(REPO_ROOT, { full });
  const issues = await auditMarkdownDeadLinks(REPO_ROOT, { full, online });
  const errors = issues.filter((i) => i.severity === "error");

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-markdown-links",
        ok: errors.length === 0,
        online,
        full,
        filesScanned: paths.length,
        issues,
      })
    );
    return errors.length === 0 ? 0 : 1;
  }

  console.log(formatMarkdownDeadLinkReport(issues));
  if (paths.length > 0 && issues.length === 0) {
    console.log(
      `  scanned ${paths.length} markdown file(s)${full ? " (full)" : " (agent subset)"}`
    );
  }
  return errors.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
