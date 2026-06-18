#!/usr/bin/env bun
/**
 * @deprecated Pattern checks (no-console, no-process-exit, no-require-imports) are now
 * handled by oxlint rules in .oxlintrc.json. This file is kept for reference but is no
 * longer invoked by the lint pipeline.
 *
 * Fail on anti-patterns in kimi-toolchain sources:
 * - console.* in src/lib/ (except logger.ts)
 * - console.* in src/bin/
 * - require() in ESM .ts files under src/
 * - process.exit in src/lib/
 */

import { join } from "path";
import { readTextAsync } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");

// Allowlists: src/lib/ should use createLogger(), not console.* or process.exit.
const LIB_CONSOLE_ALLOW = new Set([
  "src/lib/logger.ts", // implements logging; console is intentional here
]);
const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);

export interface PatternViolation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

function scanFile(rel: string, text: string): PatternViolation[] {
  const violations: PatternViolation[] = [];
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
      if (/process\.exit\(/.test(line)) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "no-process-exit-in-lib",
          snippet: line.trim().slice(0, 120),
        });
      }
    }

    if (rel.startsWith("src/bin/")) {
      if (/console\.(log|warn|error)\(/.test(line)) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "no-console-in-bin",
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
  return violations;
}

export async function lintPatternViolations(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<PatternViolation[]> {
  const violations: PatternViolation[] = [];

  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("src/") || !rel.endsWith(".ts")) continue;
      if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
      let text: string;
      try {
        text = await readTextAsync(join(root, rel));
      } catch {
        continue;
      }
      violations.push(...scanFile(rel, text));
    }
    return violations;
  }

  for await (const rel of SCAN_GLOB.scan({ cwd: root, onlyFiles: true })) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
    let text: string;
    try {
      text = await readTextAsync(join(root, rel));
    } catch {
      continue;
    }
    violations.push(...scanFile(rel, text));
  }

  return violations;
}

async function main() {
  const fileArgs = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const violations = await lintPatternViolations(
    REPO_ROOT,
    fileArgs.length > 0 ? fileArgs : undefined
  );

  if (violations.length > 0) {
    console.error("✗ Pattern violations found:\n");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}]`);
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
