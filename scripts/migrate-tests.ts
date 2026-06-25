#!/usr/bin/env bun
/**
 * Migrate test files to Bun-native conventions.
 *
 * Transformations (safe, idempotent):
 * - Replace node:fs / fs sync calls with bun-io.ts helpers.
 * - Normalize node:path / node:os imports to standard imports.
 * - Replace Bun.spawnSync(["rm", "-rf", ...]) with cleanupPath().
 * - Replace mkdtempSync(tmpdir()) patterns with testTempDir().
 * - Replace manual HOME save/restore with withIsolatedHome() where obvious.
 *
 * Usage:
 *   bun run scripts/migrate-tests.ts --dry-run
 *   bun run scripts/migrate-tests.ts --write
 */

import { dirname, relative } from "path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const BUN_IO = new URL("../src/lib/bun-io.ts", import.meta.url).pathname;
const HELPERS = new URL("../test/helpers.ts", import.meta.url).pathname;
const dryRun = Bun.argv.includes("--dry-run");
const shouldWrite = Bun.argv.includes("--write") || Bun.argv.includes("--fix");

const SYNC_FS_NAMES = new Set([
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

const BUN_IO_REPLACEMENTS: Array<[RegExp, string]> = [
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

function helpersPath(absFile: string): string {
  let rel = relative(dirname(absFile), HELPERS).replace(/\\/g, "/");
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
  const names = [
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
  ];
  for (const name of names) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(text)) used.add(name);
  }
  return used;
}

function collectUsedHelpers(text: string): Set<string> {
  const used = new Set<string>();
  const names = [
    "REPO_ROOT",
    "testTempDir",
    "cleanupPath",
    "withTempDir",
    "withIsolatedHome",
    "withEnv",
  ];
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(text)) used.add(name);
  }
  return used;
}

function rewriteCalls(text: string): string {
  let next = text;
  for (const [pattern, replacement] of BUN_IO_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  // Bun.spawnSync(["rm", "-rf", dir]) -> cleanupPath(dir)
  next = next.replace(
    /Bun\.spawnSync\(\s*\[\s*["']rm["']\s*,\s*["']-rf["']\s*,\s*([^\]]+)\s*\]\s*\)/g,
    "cleanupPath($1)"
  );
  // mkdtempSync(join(tmpdir(), "prefix")) -> testTempDir("prefix")
  next = next.replace(
    /mkdtempSync\(\s*join\(\s*tmpdir\(\)\s*,\s*["']([^"']+)["']\s*\)\s*\)/g,
    'testTempDir("$1")'
  );
  // mkdtempSync(join(REPO_ROOT, "node_modules", ".smoke-")) -> testTempDir("smoke")
  next = next.replace(
    /mkdtempSync\(\s*join\(\s*REPO_ROOT\s*,\s*["']node_modules["']\s*,\s*["']\.smoke-[^"]*["']\s*\)\s*\)/g,
    'testTempDir("smoke")'
  );
  // join(tmpdir(), `prefix-${Bun.randomUUIDv7()}`) -> testTempDir("prefix")
  next = next.replace(
    /join\(\s*tmpdir\(\)\s*,\s*`([^$`{}]+)\$\{Bun\.randomUUIDv7\(\)\}`\s*\)/g,
    'testTempDir("$1")'
  );
  // join(tmpdir(), `prefix-${Date.now()}`) -> testTempDir("prefix")
  next = next.replace(
    /join\(\s*tmpdir\(\)\s*,\s*`([^$`{}]+)\$\{Date\.now\(\)\}`\s*\)/g,
    'testTempDir("$1")'
  );
  // process.env -> Bun.env in test code
  next = next.replace(/\bprocess\.env\b/g, "Bun.env");
  // const REPO_ROOT = join(import.meta.dir, "..") -> import from helpers
  next = next.replace(/const REPO_ROOT = join\(import\.meta\.dir,\s*"\.\."\);\s*\n/g, "");
  next = next.replace(/const REPO_ROOT = import\.meta\.dir \+ "\/\.\.\/\.\.";\s*\n/g, "");
  return next;
}

function upsertImport(
  text: string,
  absFile: string,
  importPath: string,
  used: Set<string>
): string {
  if (used.size === 0) return text;

  const specList = [...used].sort().join(", ");
  const line = `import { ${specList} } from "${importPath}";`;

  const escapedPath = importPath.replace(/\./g, "\\.").replace(/\//g, "\\/");
  const existing = text.match(
    new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+["']${escapedPath}["'];?`)
  );
  if (existing) {
    const specs = new Set(parseSpecifiers(existing[1] ?? ""));
    for (const name of used) specs.add(name);
    const merged = `import { ${[...specs].sort().join(", ")} } from "${importPath}";`;
    return text.replace(existing[0], merged);
  }

  // Find the end of the import block to insert the new import there.
  const importBlockPattern =
    /^(\/\*\*[\s\S]*?\*\/\s*\n|import\s+.*?from\s+["'][^"']+["'];?\s*\n|\/\/[^\n]*\n)+/;
  const blockMatch = text.match(importBlockPattern);
  if (blockMatch) {
    const end = blockMatch[0].length;
    return `${text.slice(0, end)}${line}\n${text.slice(end)}`;
  }

  const leading = text.match(/^(\/\*\*[\s\S]*?\*\/\s*\n|\/\/[^\n]*\n)*/)?.[0] ?? "";
  const body = text.slice(leading.length).replace(/^\n+/, "");
  return `${leading}${line}\n${body}`;
}

function stripFsImports(text: string): string {
  return text.replace(IMPORT_BLOCK, (full, typePrefix, raw, from) => {
    const source = from.replace(/^node:/, "");
    if (source !== "fs") return full;
    const kept = parseSpecifiers(raw).filter((s) => {
      const base = s.replace(/^type\s+/, "").trim();
      return !SYNC_FS_NAMES.has(base);
    });
    if (kept.length === 0) return "";
    return `import ${typePrefix ?? ""}{ ${kept.join(", ")} } from "${from}";\n`;
  });
}

function normalizeNodeImports(text: string): string {
  return text.replace(IMPORT_BLOCK, (full, typePrefix, raw, from) => {
    if (from === "node:path") {
      return `import ${typePrefix ?? ""}{ ${raw.trim()} } from "path";\n`;
    }
    if (from === "node:os") {
      return `import ${typePrefix ?? ""}{ ${raw.trim()} } from "os";\n`;
    }
    return full;
  });
}

function stripUnusedTmpdirImport(text: string): string {
  if (!/\btmpdir\s*\(\s*\)/.test(text)) {
    return text.replace(/import\s+\{\s*tmpdir\s*(,\s*)?\}\s+from\s+["']os["'];?\s*\n?/g, "");
  }
  return text;
}

function rewriteFile(absFile: string, text: string): string | null {
  let next = normalizeNodeImports(text);
  next = rewriteCalls(next);
  next = stripFsImports(next);
  next = stripUnusedTmpdirImport(next);

  const usedBunIo = collectUsedBunIo(next);
  next = upsertImport(next, absFile, bunIoPath(absFile), usedBunIo);

  const usedHelpers = collectUsedHelpers(next);
  next = upsertImport(next, absFile, helpersPath(absFile), usedHelpers);

  return next === text ? null : next;
}

let count = 0;
const glob = new Bun.Glob("test/**/*.test.ts");
for await (const rel of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
  const abs = join(REPO_ROOT, rel);
  const text = await Bun.file(abs).text();
  const next = rewriteFile(abs, text);
  if (!next) continue;
  if (shouldWrite && !dryRun) await Bun.write(abs, next);
  console.log(`${dryRun || !shouldWrite ? "would patch" : "patched"} ${rel}`);
  count++;
}

console.log(`${dryRun || !shouldWrite ? "Would patch" : "Patched"} ${count} file(s)`);
if (!shouldWrite && !dryRun) {
  console.log("Run with --write to apply changes.");
}
