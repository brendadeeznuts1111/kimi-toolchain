#!/usr/bin/env bun
/**
 * find-duplicates.ts — Find exact-duplicate files, same-size near-duplicates,
 * and duplicate/near-duplicate package.json scripts.
 *
 * Usage:
 *   bun run find:duplicates
 *   bun run find:duplicates --exact
 *   bun run find:duplicates --scripts
 *   bun run find:duplicates --json
 */

import { repoRoot, scanSourceFilesSync } from "../src/lib/globs.ts";

const ROOT = repoRoot(".");

function relPath(fullPath: string): string {
  return fullPath.startsWith(ROOT + "/") ? fullPath.slice(ROOT.length + 1) : fullPath;
}

function joinRoot(...parts: string[]): string {
  return [ROOT, ...parts].join("/");
}
const JSON_MODE = Bun.argv.includes("--json");
const EXACT_ONLY = Bun.argv.includes("--exact");
const SCRIPTS_ONLY = Bun.argv.includes("--scripts");
const NEAR_THRESHOLD = 0.8;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".kimi-artifacts",
  ".cache",
  "coverage",
  "dist",
  "profiles",
]);

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "toml",
  "yaml",
  "yml",
  "sh",
  "bash",
  "zsh",
  "css",
  "html",
  "txt",
]);

interface FileEntry {
  path: string;
  rel: string;
  size: number;
  hash: string;
}

interface ExactDuplicateGroup {
  hash: string;
  size: number;
  paths: string[];
}

interface NearDuplicateGroup {
  paths: string[];
  similarity: number;
  reason: string;
}

interface ScriptGroup {
  command: string;
  names: string[];
}

function isIgnoredDir(rel: string): boolean {
  const parts = rel.split("/");
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function isTextFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

async function collectFiles(): Promise<FileEntry[]> {
  const files = scanSourceFilesSync(ROOT, { includeScripts: true, includeExamples: true });
  const entries: FileEntry[] = [];
  for (const fullPath of files) {
    const rel = relPath(fullPath);
    if (isIgnoredDir(rel)) continue;
    const file = Bun.file(fullPath);
    const size = file.size;
    if (size === 0) continue;
    const buffer = await file.arrayBuffer();
    const hash = new Bun.CryptoHasher("sha256").update(new Uint8Array(buffer)).digest("hex");
    entries.push({ path: fullPath, rel, size, hash });
  }
  return entries;
}

function findExactDuplicates(entries: FileEntry[]): ExactDuplicateGroup[] {
  const byHash = new Map<string, FileEntry[]>();
  for (const entry of entries) {
    const list = byHash.get(entry.hash) ?? [];
    list.push(entry);
    byHash.set(entry.hash, list);
  }
  return [...byHash.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([hash, list]) => ({ hash, size: list[0]!.size, paths: list.map((e) => e.rel).sort() }))
    .sort((a, b) => b.size - a.size);
}

function jaccardSimilarity(a: string, b: string): number {
  const linesA = new Set(a.split(/\r?\n/).filter((line) => line.trim().length > 0));
  const linesB = new Set(b.split(/\r?\n/).filter((line) => line.trim().length > 0));
  if (linesA.size === 0 && linesB.size === 0) return 1;
  let intersection = 0;
  for (const line of linesA) {
    if (linesB.has(line)) intersection++;
  }
  const union = new Set([...linesA, ...linesB]).size;
  return union === 0 ? 0 : intersection / union;
}

async function findNearDuplicates(entries: FileEntry[]): Promise<NearDuplicateGroup[]> {
  const bySize = new Map<number, FileEntry[]>();
  for (const entry of entries) {
    if (!isTextFile(entry.path)) continue;
    const list = bySize.get(entry.size) ?? [];
    list.push(entry);
    bySize.set(entry.size, list);
  }

  const groups: NearDuplicateGroup[] = [];
  for (const [, list] of bySize) {
    if (list.length < 2) continue;
    // Exact duplicates are reported separately; skip identical hashes here.
    const distinct = [...new Map(list.map((e) => [e.hash, e])).values()];
    if (distinct.length < 2) continue;
    const texts = await Promise.all(
      distinct.map(async (e) => ({ entry: e, text: await Bun.file(e.path).text() }))
    );
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const sim = jaccardSimilarity(texts[i]!.text, texts[j]!.text);
        if (sim >= NEAR_THRESHOLD) {
          groups.push({
            paths: [texts[i]!.entry.rel, texts[j]!.entry.rel].sort(),
            similarity: sim,
            reason: `same size (${texts[i]!.entry.size} bytes), Jaccard ${(sim * 100).toFixed(1)}%`,
          });
        }
      }
    }
  }
  return groups.sort((a, b) => b.similarity - a.similarity);
}

async function findScriptDuplicates(): Promise<{ exact: ScriptGroup[]; near: ScriptGroup[] }> {
  const pkg = await Bun.file(joinRoot("package.json")).json();
  const scripts = pkg.scripts as Record<string, string>;
  const byCommand = new Map<string, string[]>();
  for (const [name, cmd] of Object.entries(scripts)) {
    const list = byCommand.get(cmd) ?? [];
    list.push(name);
    byCommand.set(cmd, list);
  }
  const exact = [...byCommand.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([command, names]) => ({ command, names: names.sort() }));

  // Near-duplicate scripts: commands that differ only by trailing flags/args.
  const near: ScriptGroup[] = [];
  const entries = Object.entries(scripts);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [nameA, cmdA] = entries[i]!;
      const [nameB, cmdB] = entries[j]!;
      if (cmdA === cmdB) continue;
      const [shorter, longer] = cmdA.length < cmdB.length ? [cmdA, cmdB] : [cmdB, cmdA];
      if (longer.startsWith(shorter + " ")) {
        near.push({
          command: `${cmdA} / ${cmdB}`,
          names: [nameA, nameB].sort(),
        });
      }
    }
  }
  return { exact, near };
}

function printReport(report: {
  exact: ExactDuplicateGroup[];
  near: NearDuplicateGroup[];
  scripts: { exact: ScriptGroup[]; near: ScriptGroup[] };
}): void {
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`find-duplicates — scanned repo root: ${ROOT}`);
  console.log("");

  if (!SCRIPTS_ONLY) {
    if (report.exact.length === 0) {
      console.log("Exact duplicate files: none");
    } else {
      console.log(`Exact duplicate files: ${report.exact.length} group(s)`);
      for (const group of report.exact) {
        console.log(`  hash ${group.hash.slice(0, 16)}… (${group.size} bytes)`);
        for (const path of group.paths) console.log(`    - ${path}`);
      }
    }
    console.log("");

    if (EXACT_ONLY) return;

    if (report.near.length === 0) {
      console.log("Near-duplicate files: none");
    } else {
      console.log(`Near-duplicate files: ${report.near.length} pair(s)`);
      for (const group of report.near) {
        console.log(`  ${group.reason}`);
        for (const path of group.paths) console.log(`    - ${path}`);
      }
    }
    console.log("");
  }

  if (report.scripts.exact.length === 0) {
    console.log("Duplicate package.json scripts: none");
  } else {
    console.log(`Duplicate package.json scripts: ${report.scripts.exact.length} group(s)`);
    for (const group of report.scripts.exact) {
      console.log(`  ${group.names.join(" / ")}`);
      console.log(`    -> ${group.command}`);
    }
  }
  console.log("");

  if (report.scripts.near.length === 0) {
    console.log("Near-duplicate package.json scripts: none");
  } else {
    console.log(`Near-duplicate package.json scripts: ${report.scripts.near.length} pair(s)`);
    for (const group of report.scripts.near) {
      console.log(`  ${group.names.join(" / ")}`);
      console.log(`    -> ${group.command}`);
    }
  }
}

async function main(): Promise<number> {
  const entries = await collectFiles();
  const exact = findExactDuplicates(entries);
  const near = EXACT_ONLY || SCRIPTS_ONLY ? [] : await findNearDuplicates(entries);
  const scripts = await findScriptDuplicates();
  printReport({ exact, near, scripts });
  return 0;
}

process.exit(await main());
