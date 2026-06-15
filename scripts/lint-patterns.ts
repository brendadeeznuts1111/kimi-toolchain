#!/usr/bin/env bun
/**
 * Fail on anti-patterns in kimi-toolchain sources:
 * - console.* in src/lib/ (except logger.ts)
 * - require() in ESM .ts files under src/
 * - process.exit in src/lib/
 */

import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

const LIB_CONSOLE_ALLOW = new Set([
  "src/lib/logger.ts",
  "src/lib/step-budget.ts",
  // Legacy modules pending logger migration (Track 1):
  "src/lib/utils.ts",
  "src/lib/tool-registry.ts",
  "src/lib/governor-cache.ts",
  "src/lib/memory-budget.ts",
  "src/lib/readme-sync.ts",
  "src/lib/workspace-commands.ts",
]);
const LIB_EXIT_ALLOW = new Set(["src/lib/readme-sync.ts"]);
const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

async function main() {
  const violations: Violation[] = [];

  for await (const rel of SCAN_GLOB.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;

    const path = join(REPO_ROOT, rel);
    let text: string;
    try {
      text = await Bun.file(path).text();
    } catch {
      continue;
    }

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;

      if (rel.startsWith("src/lib/") && !LIB_CONSOLE_ALLOW.has(rel)) {
        if (/console\.(log|warn|error)\(/.test(line)) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "no-console-in-lib",
            snippet: line.trim().slice(0, 120),
          });
        }
        if (/process\.exit\(/.test(line) && !LIB_EXIT_ALLOW.has(rel)) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "no-process-exit-in-lib",
            snippet: line.trim().slice(0, 120),
          });
        }
      }

      if (rel.startsWith("src/") && /\brequire\s*\(/.test(line) && !line.trim().startsWith("//")) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "no-require-in-esm",
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("✗ Pattern violations found:\n");
    for (const v of violations) {
      console.error(`  ${relative(REPO_ROOT, v.file)}:${v.line} [${v.rule}]`);
      console.error(`    ${v.snippet}\n`);
    }
    process.exit(1);
  }

  console.log("  ✓ No pattern violations");
}

main().catch((err) => {
  console.error("lint-patterns failed:", err.message);
  process.exit(1);
});
