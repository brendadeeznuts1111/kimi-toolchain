#!/usr/bin/env bun
/**
 * Fail on anti-patterns in kimi-toolchain sources:
 * - console.* in src/lib/ (except logger.ts and probe fixtures)
 * - console.* in src/bin/
 * - require() in ESM .ts files under src/ (except probe fixture literals)
 * - process.exit in src/lib/
 */

import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

const LIB_CONSOLE_ALLOW = new Set([
  "src/lib/logger.ts",
  "src/lib/compile-target.ts",
  "src/lib/mcp-bridge-scaffold.ts",
  "src/lib/herdr-dashboard/webview/options.ts",
]);

/** Probe harnesses embed console/require snippets as fixture strings — not runtime calls. */
const LIB_PROBE_FIXTURES = new Set([
  "src/lib/bun-cli-contract-probes.ts",
  "src/lib/bun-cli-env-probes.ts",
  "src/lib/bun-cli-bun-test-probes.ts",
  "src/lib/bun-cli-run-test-probes.ts",
  "src/lib/bun-cli-test-changed-probes.ts",
  "src/lib/bun-cli-markdown-probes.ts",
  "src/lib/bun-cli-fixture.ts",
  "src/lib/bun-install-config.ts",
  "src/lib/test-runtime.ts",
  "src/lib/build-info.ts",
  "src/lib/bun-utils.ts",
]);

const BIN_CONSOLE_ALLOW = new Set<string>([]);
const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".kimi-artifacts"]);

interface Violation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

function isCommentOrDocLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/**") ||
    trimmed.startsWith("*/")
  );
}

function isLibExempt(rel: string): boolean {
  return LIB_CONSOLE_ALLOW.has(rel) || LIB_PROBE_FIXTURES.has(rel);
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
      if (isCommentOrDocLine(line)) continue;

      if (rel.startsWith("src/lib/") && !isLibExempt(rel)) {
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

      if (rel.startsWith("src/bin/") && !BIN_CONSOLE_ALLOW.has(rel)) {
        if (/console\.(log|warn|error)\(/.test(line)) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "no-console-in-bin",
            snippet: line.trim().slice(0, 120),
          });
        }
      }

      if (rel.startsWith("src/") && !LIB_PROBE_FIXTURES.has(rel) && /\brequire\s*\(/.test(line)) {
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
