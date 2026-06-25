#!/usr/bin/env bun
/**
 * @deprecated Merged into scripts/lint-test-names.ts (lintTestConventions export).
 * Kept for reference. Tests run via lint-test-names.ts which handles both naming
 * and convention checks in a single pass.
 *
 * Enforce Bun-native test conventions — see test/testing.md.
 *
 * Rules (enforce on test/*.ts files, excluding helpers.ts):
 * - No node:fs / fs sync imports
 * - No process.env — use Bun.env or withEnv()
 * - No console.log = / console.error = — use captureConsole helpers
 * - No duplicate REPO_ROOT — import from test/helpers.ts
 * - No mkdtempSync / readFileSync / writeFileSync
 */

import { join } from "path";
const REPO_ROOT = join(import.meta.dir, "..");
const HELPERS = "test/helpers.ts";

const RULES: Array<{
  id: string;
  pattern: RegExp;
  message: string;
  exempt?: RegExp;
}> = [
  {
    id: "node-fs-import",
    pattern: /from\s+["'](?:node:)?fs["']/,
    message: "Use Bun.file / bun-io.ts or test/helpers.ts instead of fs imports",
  },
  {
    id: "process-env",
    pattern: /\bprocess\.env\b/,
    message: "Use Bun.env or withEnv() from test/helpers.ts",
  },
  {
    id: "console-assign",
    pattern: /\bconsole\.(log|error|warn)\s*=/,
    message: "Use captureConsole / captureConsoleError / captureStdout from test/helpers.ts",
    exempt: /test\/helpers\.ts$/,
  },
  {
    id: "sync-fs-api",
    pattern: /\b(readFileSync|writeFileSync|mkdirSync|rmSync|mkdtempSync|existsSync)\s*\(/,
    message: "Use bun-io.ts helpers or test/helpers.ts",
  },
  {
    id: "spawn-rm-rf",
    pattern: /Bun\.spawnSync\(\s*\[\s*["']rm["']\s*,\s*["']-rf["']/,
    message: "Use cleanupPath() from test/helpers.ts",
  },
  {
    id: "local-repo-root",
    pattern: /const\s+REPO_ROOT\s*=\s*join\s*\(\s*import\.meta\.dir/,
    message: "Import { REPO_ROOT } from test/helpers.ts (or relative ./helpers.ts)",
    exempt: /test\/helpers\.ts$/,
  },
];

interface Violation {
  file: string;
  line: number;
  ruleId: string;
  message: string;
  snippet: string;
}

function stripStringLiterals(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function scanFile(rel: string, text: string): Violation[] {
  if (rel === HELPERS) return [];

  const lines = text.split("\n");
  const violations: Violation[] = [];

  for (const rule of RULES) {
    if (rule.exempt?.test(rel)) continue;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      if (raw.trimStart().startsWith("//")) continue;
      const line = stripStringLiterals(raw);
      if (!rule.pattern.test(line)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        ruleId: rule.id,
        message: rule.message,
        snippet: raw.trim().slice(0, 120),
      });
    }
  }

  return violations;
}

const violations: Violation[] = [];
const glob = new Bun.Glob("test/**/*.ts");
for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const text = await Bun.file(join(REPO_ROOT, rel)).text();
  violations.push(...scanFile(rel, text));
}

if (violations.length === 0) {
  console.log("test conventions: ok");
  process.exit(0);
}

console.error(`test conventions: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.ruleId}] ${v.message}`);
  console.error(`    ${v.snippet}`);
}
process.exit(1);
