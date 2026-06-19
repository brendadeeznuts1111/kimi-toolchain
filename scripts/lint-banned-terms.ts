#!/usr/bin/env bun
/**
 * Fail if internal-only branding (e.g. Tier-1380) appears in repo sources.
 * Markdown and docs are not covered by oxlint — this script gates them.
 */

import { existsSync } from "fs";
import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

/** Patterns that must not appear in user-facing or agent-facing docs */
const BANNED: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Tier[- ]?1380/i, label: "Tier-1380 internal tag (use global Bun-native wording)" },
];

const SCAN_GLOB = new Bun.Glob("**/*.{md,ts,json,toml}");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".bun", ".kimi-artifacts"]);
/** Files that define or embed the ban rule itself */
const SKIP_FILES = new Set(["scripts/lint-banned-terms.ts", "src/bin/kimi-fix.ts"]);

function shouldScan(rel: string): boolean {
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  if (SKIP_FILES.has(rel) || rel === "bun.lock") return false;
  return true;
}

/**
 * Scan repo (or scoped paths) for banned terms.
 * Returns human-readable violation strings; empty when clean.
 */
export async function lintBannedTerms(repoRoot: string, paths?: string[]): Promise<string[]> {
  const violations: string[] = [];
  const relPaths = paths && paths.length > 0 ? paths.filter((rel) => shouldScan(rel)) : null;

  if (relPaths) {
    for (const rel of relPaths) {
      const path = join(repoRoot, rel);
      let text: string;
      try {
        text = await Bun.file(path).text();
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        for (const { pattern, label } of BANNED) {
          if (pattern.test(line)) {
            violations.push(`${rel}: ${label}\n  ${line.trim().slice(0, 120)}`);
          }
        }
      }
    }
    return violations;
  }

  for await (const rel of SCAN_GLOB.scan({ cwd: repoRoot, onlyFiles: true })) {
    if (!shouldScan(rel)) continue;

    const path = join(repoRoot, rel);
    let text: string;
    try {
      text = await Bun.file(path).text();
    } catch {
      continue;
    }

    for (const line of text.split("\n")) {
      for (const { pattern, label } of BANNED) {
        if (pattern.test(line)) {
          violations.push(`${relative(repoRoot, path)}: ${label}\n  ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }

  return violations;
}

async function main() {
  const violations = await lintBannedTerms(REPO_ROOT);

  if (violations.length > 0) {
    console.error("✗ Banned terms found:\n");
    for (const v of violations) console.error(`  ${v}\n`);
    process.exit(1);
  }

  if (!existsSync(join(REPO_ROOT, ".oxlintrc.json"))) {
    console.warn("  ⚠ .oxlintrc.json missing");
  }

  console.log("  ✓ No banned terms");
}

main().catch((err) => {
  console.error("lint-banned-terms failed:", err.message);
  process.exit(1);
});
