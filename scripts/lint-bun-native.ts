#!/usr/bin/env bun
/**
 * Fail on Bun-native drift in kimi-toolchain sources:
 * - imports of Node.js APIs or npm packages that have Bun equivalents
 * - process.env usage (should be Bun.env)
 * - raw JSON.stringify used for console/stdout emission (should use inspectAgent)
 *
 * Add @bun-native-exempt on a line to suppress a specific violation.
 */

import { join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");

const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);

const BANNED_IMPORTS: Record<string, string> = {
  "node:child_process": "Bun.spawn / Bun.spawnSync",
  "node:fs": "Bun.file / Bun.write",
  "node:http": "Bun.serve",
  "node:https": "Bun.serve",
  "node:crypto": "Bun.hash / Bun.CryptoHasher",
  "node:zlib": "Bun.deflateSync / Bun.gunzipSync",
  "node:dns": "Bun.dns",
  "node:events": "Effect Stream",
  glob: "Bun.Glob",
  "fast-glob": "Bun.Glob",
  toml: "Bun.TOML",
  "@iarna/toml": "Bun.TOML",
  semver: "Bun.semver",
  bcrypt: "Bun.password",
  bcryptjs: "Bun.password",
  argon2: "Bun.password",
  which: "Bun.which",
};

interface Violation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

function lineHasExemption(line: string): boolean {
  return line.includes("@bun-native-exempt");
}

async function main() {
  const violations: Violation[] = [];
  const bannedImportRegex = new RegExp(
    `from\\s+["'](${Object.keys(BANNED_IMPORTS).map(escapeRegExp).join("|")})["']`,
    "g"
  );
  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  const processEnvRegex = /\bprocess\.env\b/g;
  const stringifyStdoutRegex =
    /(?:console\.(log|error|warn|info|debug)|process\.stdout\.write)\s*\([^)]*JSON\.stringify\s*\(/g;

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
      const raw = lines[i];
      const lineNo = i + 1;
      const line = raw ?? "";
      if (line.trim().startsWith("//")) continue;
      if (lineHasExemption(line)) continue;

      for (const match of line.matchAll(bannedImportRegex)) {
        const name = match[1]!;
        violations.push({
          file: rel,
          line: lineNo,
          rule: `bun-native-import (${BANNED_IMPORTS[name]})`,
          snippet: line.trim().slice(0, 120),
        });
      }

      for (const match of line.matchAll(requireRegex)) {
        const name = match[1]!;
        const replacement = BANNED_IMPORTS[name];
        if (!replacement) continue;
        violations.push({
          file: rel,
          line: lineNo,
          rule: `bun-native-require (${replacement})`,
          snippet: line.trim().slice(0, 120),
        });
      }

      for (const _ of line.matchAll(processEnvRegex)) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "bun-native-env (use Bun.env)",
          snippet: line.trim().slice(0, 120),
        });
      }

      // The stdout-stringify rule applies only to src/lib; CLI tools may still
      // emit formatted JSON directly when that is their explicit contract.
      if (rel.startsWith("lib/")) {
        for (const _ of line.matchAll(stringifyStdoutRegex)) {
          violations.push({
            file: rel,
            line: lineNo,
            rule: "bun-native-stringify-stdout (use inspectAgent from src/lib/inspect.ts)",
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("✗ Bun-native violations found:\n");
    for (const v of violations) {
      console.error(`  ${relative(REPO_ROOT, v.file)}:${v.line} [${v.rule}]`);
      console.error(`    ${v.snippet}\n`);
    }
    process.exit(1);
  }

  console.log("  ✓ No Bun-native violations");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((err) => {
  console.error("lint-bun-native failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
