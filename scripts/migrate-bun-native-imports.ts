#!/usr/bin/env bun
/**
 * Rewrite banned Node imports to src/lib/bun-native-shim.ts.
 * Usage: bun run scripts/migrate-bun-native-imports.ts [--dry-run]
 */

import { dirname, join, relative } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const SHIM = join(REPO_ROOT, "src/lib/bun-native-shim.ts");
const _BANNED = new Set(["fs", "node:fs", "node:child_process", "node:crypto", "node:zlib"]);
const dryRun = Bun.argv.includes("--dry-run");

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

function rewriteFile(absFile: string, text: string): string | null {
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

let count = 0;
const glob = new Bun.Glob("src/**/*.ts");
for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const abs = join(REPO_ROOT, rel);
  const text = await Bun.file(abs).text();
  const next = rewriteFile(abs, text);
  if (!next || next === text) continue;
  if (!dryRun) await Bun.write(abs, next);
  console.log(`${dryRun ? "would patch" : "patched"} ${rel}`);
  count++;
}

console.log(`${dryRun ? "Would patch" : "Patched"} ${count} file(s)`);
