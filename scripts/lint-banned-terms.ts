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
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".bun"]);
/** Files that define or embed the ban rule itself */
const SKIP_FILES = new Set(["scripts/lint-banned-terms.ts", "src/bin/kimi-fix.ts"]);

async function main() {
  const violations: string[] = [];

  for await (const rel of SCAN_GLOB.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
    if (SKIP_FILES.has(rel) || rel === "bun.lock") continue;

    const path = join(REPO_ROOT, rel);
    let text: string;
    try {
      text = await Bun.file(path).text();
    } catch {
      continue;
    }

    for (const line of text.split("\n")) {
      for (const { pattern, label } of BANNED) {
        if (pattern.test(line)) {
          violations.push(`${relative(REPO_ROOT, path)}: ${label}\n  ${line.trim().slice(0, 120)}`);
        }
      }
    }
  }

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
