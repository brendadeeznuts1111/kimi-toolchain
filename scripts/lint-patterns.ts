#!/usr/bin/env bun
/**
 * Fail on anti-patterns in kimi-toolchain sources:
 * - console.* in src/lib/ (except logger.ts)
 * - require() in ESM .ts files under src/
 * - process.exit in src/lib/
 */

import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

// Allowlists: src/lib/ should use createLogger(), not console.* or process.exit.
// Entries below are grandfathered until Track 1 logger migration lands.
const LIB_CONSOLE_ALLOW = new Set([
  "src/lib/logger.ts", // implements logging; console is intentional here
  "src/lib/step-budget.ts", // CLI progress output during long operations
  "src/lib/utils.ts", // shared CLI helpers (printToolBanner, printDoctorReport)
  "src/lib/tool-registry.ts", // meta-binary dispatch; mirrors bin listing output
  "src/lib/governor-cache.ts", // cache diagnostics for resource governor
  "src/lib/memory-budget.ts", // memory-budget table rendering for doctor/scripts
  "src/lib/readme-sync.ts", // docs:sync rewrites README from package.json
  "src/lib/workspace-commands.ts", // workspace subcommand help and status text
]);
// readme-sync exits after --fix/--check to signal CI; no logger hook yet.
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
