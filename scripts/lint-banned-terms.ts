#!/usr/bin/env bun
/**
 * Fail if internal-only branding (e.g. Tier-1380) appears in repo sources.
 * Markdown and docs are not covered by oxlint — this script gates them.
 */

import { join, relative } from "path";
import { pathExists, readTextAsync } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");

/** Patterns that must not appear in user-facing or agent-facing docs */
const BANNED: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Tier[- ]?1380/i, label: "Tier-1380 internal tag (use global Bun-native wording)" },
];

const SCAN_GLOB = new Bun.Glob("**/*.{md,ts,json,toml}");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".bun"]);
/** Files that define or embed the ban rule itself */
const SKIP_FILES = new Set(["scripts/lint-banned-terms.ts", "src/bin/kimi-fix.ts"]);

function shouldScanRel(rel: string): boolean {
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  if (SKIP_FILES.has(rel) || rel === "bun.lock") return false;
  return /\.(md|ts|json|toml)$/.test(rel);
}

export async function lintBannedTerms(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<string[]> {
  const violations: string[] = [];
  const targets = onlyFiles !== undefined ? onlyFiles.filter((rel) => shouldScanRel(rel)) : null;

  if (targets) {
    for (const rel of targets) {
      const path = join(root, rel);
      let text: string;
      try {
        text = await readTextAsync(path);
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        for (const { pattern, label } of BANNED) {
          if (pattern.test(line)) {
            violations.push(`${relative(root, path)}: ${label}\n  ${line.trim().slice(0, 120)}`);
          }
        }
      }
    }
    return violations;
  }

  for await (const rel of SCAN_GLOB.scan({ cwd: root, onlyFiles: true })) {
    if (!shouldScanRel(rel)) continue;
    const path = join(root, rel);
    let text: string;
    try {
      text = await readTextAsync(path);
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      for (const { pattern, label } of BANNED) {
        if (pattern.test(line)) {
          violations.push(`${relative(root, path)}: ${label}\n  ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }

  return violations;
}

async function main() {
  const fileArgs = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const violations = await lintBannedTerms(REPO_ROOT, fileArgs.length > 0 ? fileArgs : undefined);

  if (violations.length > 0) {
    console.error("✗ Banned terms found:\n");
    for (const v of violations) console.error(`  ${v}\n`);
    process.exit(1);
  }

  if (!pathExists(join(REPO_ROOT, ".oxlintrc.json"))) {
    console.warn("  ⚠ .oxlintrc.json missing");
  }

  console.log("  ✓ No banned terms");
}

main().catch((err) => {
  console.error("lint-banned-terms failed:", err.message);
  process.exit(1);
});
