#!/usr/bin/env bun
/**
 * Rewrite sync fs API call sites to bun-io.ts wrappers.
 * Usage: bun run scripts/migrate-sync-fs-api.ts [--dry-run]
 */

import { dirname, join, relative } from "path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const BUN_IO = new URL("../src/lib/bun-io.ts", import.meta.url).pathname;
const SKIP = new Set(["src/lib/bun-io.ts"]);
const dryRun = Bun.argv.includes("--dry-run");

const SYNC_NAMES = new Set([
  "existsSync",
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "readdirSync",
  "mkdirSync",
  "unlinkSync",
  "rmSync",
  "statSync",
  "copyFileSync",
  "renameSync",
  "lstatSync",
  "readlinkSync",
  "cpSync",
  "realpathSync",
]);

const BUN_IO_NAMES = [
  "pathExists",
  "readText",
  "writeText",
  "appendText",
  "listDir",
  "makeDir",
  "removeFile",
  "removePath",
  "pathStat",
  "copyPath",
  "movePath",
  "pathLstat",
  "readLink",
  "copyTree",
  "resolveRealPath",
] as const;

const CALL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\breadFileSync\s*\(\s*([^,)]+)\s*,\s*["']utf-?8["']\s*\)/g, "readText($1)"],
  [/\bwriteFileSync\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*["']utf-?8["']\s*\)/g, "writeText($1, $2)"],
  [/\bexistsSync\s*\(/g, "pathExists("],
  [/\breadFileSync\s*\(/g, "readText("],
  [/\bwriteFileSync\s*\(/g, "writeText("],
  [/\bappendFileSync\s*\(/g, "appendText("],
  [/\breaddirSync\s*\(/g, "listDir("],
  [/\bmkdirSync\s*\(/g, "makeDir("],
  [/\bunlinkSync\s*\(/g, "removeFile("],
  [/\brmSync\s*\(/g, "removePath("],
  [/\bstatSync\s*\(/g, "pathStat("],
  [/\bcopyFileSync\s*\(/g, "copyPath("],
  [/\brenameSync\s*\(/g, "movePath("],
  [/\blstatSync\s*\(/g, "pathLstat("],
  [/\breadlinkSync\s*\(/g, "readLink("],
  [/\bcpSync\s*\(/g, "copyTree("],
  [/\brealpathSync\s*\(/g, "resolveRealPath("],
];

const IMPORT_BLOCK = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["'];?\s*\n?/g;

function bunIoPath(absFile: string): string {
  let rel = relative(dirname(absFile), BUN_IO).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function parseSpecifiers(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function collectUsedBunIo(text: string): Set<string> {
  const used = new Set<string>();
  for (const name of BUN_IO_NAMES) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(text)) used.add(name);
  }
  return used;
}

function rewriteCalls(text: string): string {
  let next = text;
  for (const [pattern, replacement] of CALL_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function upsertBunIoImport(absFile: string, text: string, used: Set<string>): string {
  if (used.size === 0) return text;

  const importPath = bunIoPath(absFile);
  const specList = [...used].sort().join(", ");
  const line = `import { ${specList} } from "${importPath}";\n`;

  const existing = text.match(
    new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+["']${importPath.replace(/\./g, "\\.")}["'];?`)
  );
  if (existing) {
    const specs = new Set(parseSpecifiers(existing[1] ?? ""));
    for (const name of used) specs.add(name);
    const merged = `import { ${[...specs].sort().join(", ")} } from "${importPath}";`;
    return text.replace(existing[0], merged);
  }

  const shebangFirst = text.match(/^(#!\/usr\/env bun\n)/);
  if (shebangFirst) {
    const rest = text.slice(shebangFirst[1].length).replace(/^\n+/, "");
    const leading = rest.match(/^(\/\*\*[\s\S]*?\*\/\s*\n|\/\/[^\n]*\n)*/)?.[0] ?? "";
    const body = rest.slice(leading.length).replace(/^\n+/, "");
    return `${shebangFirst[1]}${leading}${line}\n${body}`;
  }

  const leading = text.match(/^(\/\*\*[\s\S]*?\*\/\s*\n|\/\/[^\n]*\n)*/)?.[0] ?? "";
  const body = text.slice(leading.length).replace(/^\n+/, "");
  return `${leading}${line}\n${body}`;
}

function stripSyncFromShimImports(text: string): string {
  return text.replace(IMPORT_BLOCK, (full, typePrefix, raw, from) => {
    if (!from.includes("bun-io")) return full;
    const kept = parseSpecifiers(raw).filter((s) => {
      const base = s.replace(/^type\s+/, "").trim();
      return !SYNC_NAMES.has(base);
    });
    if (kept.length === 0) return "";
    return `import ${typePrefix ?? ""}{ ${kept.join(", ")} } from "${from}";\n`;
  });
}

function rewriteFile(absFile: string, text: string): string | null {
  const rel = relative(REPO_ROOT, absFile).replace(/\\/g, "/");
  if (SKIP.has(rel)) return null;

  const withCalls = rewriteCalls(text);
  if (withCalls === text) return null;

  let next = stripSyncFromShimImports(withCalls);
  const used = collectUsedBunIo(next);
  next = upsertBunIoImport(absFile, next, used);
  return next === text ? null : next;
}

let count = 0;
const glob = new Bun.Glob("src/**/*.ts");
for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const abs = join(REPO_ROOT, rel);
  const text = await Bun.file(abs).text();
  const next = rewriteFile(abs, text);
  if (!next) continue;
  if (!dryRun) await Bun.write(abs, next);
  console.log(`${dryRun ? "would patch" : "patched"} ${rel}`);
  count++;
}

console.log(`${dryRun ? "Would patch" : "Patched"} ${count} file(s)`);
