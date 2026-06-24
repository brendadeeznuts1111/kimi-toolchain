#!/usr/bin/env bun
/**
 * Rewrite banned Node imports to src/lib/bun-native-shim.ts.
 * Extended: soft imports, Response-stream rewrite, --rule filter.
 *
 * Usage:
 *   bun run scripts/migrate-bun-native-imports.ts [--dry-run]
 *   bun run scripts/migrate-bun-native-imports.ts --dry-run --rule response-stream-text
 *   bun run scripts/migrate-bun-native-imports.ts --rule soft-banned-import
 */

import { dirname, join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const SHIM = join(REPO_ROOT, "src/lib/bun-native-shim.ts");

const argIdx = (name: string) => Bun.argv.indexOf(name);
const dryRun = argIdx("--dry-run") !== -1;
const ruleFilter = argIdx("--rule") !== -1 ? Bun.argv[argIdx("--rule") + 1] : undefined;

const IMPORT_BLOCK =
  /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["'](fs|node:fs|node:child_process|node:crypto|node:zlib)["'];?\s*\n?/g;

function shimPath(absFile: string): string {
  let rel = relative(dirname(absFile), SHIM).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function parseSpecifiers(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^type\s+/, "type "));
}

function rewriteBannedImports(absFile: string, text: string): string | null {
  if (absFile.endsWith("bun-native-shim.ts")) return null;
  const specs = new Set<string>();
  let hadType = false;
  let matched = false;
  for (const match of text.matchAll(IMPORT_BLOCK)) {
    matched = true;
    if (match[1]) hadType = true;
    for (const name of parseSpecifiers(match[2] ?? "")) specs.add(name);
  }
  if (!matched) return null;
  const without = text.replace(IMPORT_BLOCK, "");
  const importLine = `import ${hadType ? "type " : ""}{ ${[...specs].sort().join(", ")} } from "${shimPath(absFile)}";\n`;
  const shebangFirst = without.match(/^(#!\/usr\/env bun\n)/);
  if (shebangFirst) {
    const rest = without.slice(shebangFirst[1].length).replace(/^\n+/, "");
    return `${shebangFirst[1]}${importLine}\n${rest}`;
  }
  const leading = without.match(/^(\/\*\*[\s\S]*?\*\/\s*\n|\/\/[^\n]*\n)*/)?.[0] ?? "";
  const rest = without.slice(leading.length).replace(/^\n+/, "");
  return `${leading}${importLine}\n${rest}`;
}

const SOFT_IMPORT_RE =
  /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["'](path|node:path|os|node:os|util|node:util|buffer|node:buffer)["'];?\s*\n?/g;

interface SoftImportFinding {
  file: string;
  line: number;
  source: string;
  specifiers: string[];
}

function findSoftImports(text: string, absFile: string): SoftImportFinding[] {
  const findings: SoftImportFinding[] = [];
  for (const match of text.matchAll(SOFT_IMPORT_RE)) {
    findings.push({
      file: absFile,
      line: (text.slice(0, match.index).match(/\n/g)?.length ?? 0) + 1,
      source: match[3] ?? "",
      specifiers: parseSpecifiers(match[2] ?? ""),
    });
  }
  return findings;
}

const RESPONSE_STREAM_RE = /new\s+Response\s*\(([^)]*)\)\.(text|arrayBuffer|json)\s*\(\s*\)/g;

interface ResponseStreamFinding {
  file: string;
  line: number;
  arg: string;
  method: string;
}

function findResponseStreamPatterns(text: string, absFile: string): ResponseStreamFinding[] {
  const findings: ResponseStreamFinding[] = [];
  for (const match of text.matchAll(RESPONSE_STREAM_RE)) {
    findings.push({
      file: absFile,
      line: (text.slice(0, match.index).match(/\n/g)?.length ?? 0) + 1,
      arg: match[1] ?? "",
      method: match[2] ?? "",
    });
  }
  return findings;
}

function rewriteResponseStream(text: string): string | null {
  const next = text.replace(RESPONSE_STREAM_RE, (_, arg: string, method: string) => {
    const reader =
      method === "text"
        ? "Bun.readableStreamToText"
        : method === "arrayBuffer"
          ? "Bun.readableStreamToArrayBuffer"
          : "Bun.readableStreamToJSON";
    return `${reader}(${arg})`;
  });
  return next !== text ? next : null;
}

function formatSummary(counts: Record<string, number>): string[] {
  const lines: string[] = [];
  for (const [key, n] of Object.entries(counts)) {
    if (n > 0) lines.push(`  ${key}: ${n}`);
  }
  return lines;
}

const GLOB_PATTERNS = ["src/**/*.ts", "scripts/**/*.ts", "examples/**/*.ts"];

let shimCount = 0;
let softCount = 0;
let responseCount = 0;

for (const pattern of GLOB_PATTERNS) {
  const glob = new Bun.Glob(pattern);
  for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    const abs = join(REPO_ROOT, rel);
    if (rel.split("/").some((seg) => ["node_modules", ".git", "coverage"].includes(seg))) continue;
    const text = await Bun.file(abs).text();

    if (!ruleFilter || ruleFilter === "banned-import" || ruleFilter === "banned-require") {
      const next = rewriteBannedImports(abs, text);
      if (next && next !== text) {
        if (!dryRun) await Bun.write(abs, next);
        console.log(`${dryRun ? "would patch" : "patched"} [banned-import] ${rel}`);
        shimCount++;
      }
    }

    if (!ruleFilter || ruleFilter === "soft-banned-import") {
      const findings = findSoftImports(text, abs);
      for (const f of findings) {
        console.log(
          `${dryRun ? "would flag" : "flagged"} [soft-banned-import] ${rel}:${f.line} from "${f.source}" — ${f.specifiers.join(", ")}`
        );
        softCount++;
      }
    }

    if (!ruleFilter || ruleFilter === "response-stream-text") {
      const findings = findResponseStreamPatterns(text, abs);
      if (findings.length === 0) continue;
      if (ruleFilter) {
        const next = rewriteResponseStream(text);
        if (next && next !== text) {
          if (!dryRun) await Bun.write(abs, next);
          console.log(
            `${dryRun ? "would patch" : "patched"} [response-stream-text] ${rel} (${findings.length} occurrence(s))`
          );
          responseCount++;
        }
      } else {
        for (const f of findings) {
          console.log(
            `found [response-stream-text] ${rel}:${f.line} — new Response(${f.arg}).${f.method}()`
          );
        }
      }
    }
  }
}

const summary = formatSummary({
  "banned-import rewrites": shimCount,
  "soft-banned-import occurrences": softCount,
  "response-stream-text rewrites": responseCount,
});
console.log(`\nSummary (${dryRun ? "dry run" : "applied"}):`);
for (const line of summary) console.log(line);
