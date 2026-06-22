#!/usr/bin/env bun
/**
 * autophagy-scan.ts — Repo-wide hygiene scan (process.env, dead branches).
 *
 * Usage:
 *   bun run autophagy:scan
 *   bun run autophagy:scan:gate
 */

import { relative } from "path";
import { scanSourceText } from "../src/lib/autophagy-scan.ts";
import { repoRoot, scanSourceFilesSync } from "../src/lib/globs.ts";

const ROOT = repoRoot(".");
const JSON_MODE = process.argv.includes("--json");
const BRIEF = process.argv.includes("--brief");
const EXIT_CODE = process.argv.includes("--exit-code");
const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<number> {
  const files = scanSourceFilesSync(ROOT, { includeScripts: true, includeExamples: true });

  if (DRY_RUN) {
    const summary = {
      tool: "autophagy-scan",
      mode: "dry-run",
      projectRoot: ROOT,
      files: files.length,
    };
    console.log(
      JSON_MODE
        ? JSON.stringify(summary, null, 2)
        : `autophagy:scan dry-run — would scan ${files.length} file(s)`
    );
    return 0;
  }

  const findings = [];
  for (const fullPath of files) {
    const text = await Bun.file(fullPath).text();
    findings.push(...scanSourceText(relative(ROOT, fullPath), text));
  }

  if (JSON_MODE) {
    console.log(
      JSON.stringify({ findings, count: findings.length, scanned: files.length }, null, 2)
    );
  } else if (BRIEF) {
    console.log(`autophagy:scan — ${findings.length} finding(s) in ${files.length} file(s)`);
  } else if (findings.length === 0) {
    console.log(`autophagy:scan — no findings in ${files.length} file(s)`);
  } else {
    console.log(`autophagy:scan — ${findings.length} finding(s):`);
    for (const finding of findings) {
      console.log(`  ${finding.file}:${finding.line} [${finding.kind}] ${finding.snippet}`);
    }
  }

  if (EXIT_CODE && findings.length > 0) return 1;
  return 0;
}

process.exit(await main());
