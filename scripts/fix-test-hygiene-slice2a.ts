#!/usr/bin/env bun
/**
 * Slice 2a — replace node:fs read/write/exists in test/effect/ with Bun-native APIs.
 *
 * Mechanical replacements:
 *   readFileSync(path, "utf-8") → await Bun.file(path).text()
 *   writeFileSync(path, data)  → await Bun.write(path, data)
 *   existsSync(path)           → await Bun.file(path).exists()
 *
 * mkdirSync / rmSync / readdirSync have no Bun-native equivalent — keep node:fs import.
 * After running: verify parent functions are async and `if (await Bun.file(...).exists())`.
 */
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const FS_IMPORT = /import\s*\{[^}]+\}\s*from\s*["'](?:node:)?fs["'];\n?/;
const STILL_NEEDS_FS = /(mkdirSync|rmSync|readdirSync|appendFileSync)\s*\(/;

function applyBunNativeReplacements(content: string): string {
  let updated = content;

  updated = updated.replace(
    /readFileSync\(([^,]+),\s*["']utf-?8["']\)/g,
    "await Bun.file($1).text()"
  );
  updated = updated.replace(/writeFileSync\(/g, "await Bun.write(");
  updated = updated.replace(/existsSync\(([^)]+)\)/g, "await Bun.file($1).exists()");

  if (!STILL_NEEDS_FS.test(updated)) {
    updated = updated.replace(FS_IMPORT, "");
  }

  return updated;
}

async function main(): Promise<void> {
  const glob = new Bun.Glob("test/effect/**/*.ts");
  let changed = 0;

  for await (const rel of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    const path = join(ROOT, rel);
    const original = await Bun.file(path).text();
    const updated = applyBunNativeReplacements(original);

    if (updated !== original) {
      await Bun.write(path, updated);
      console.log(`✅ ${rel}`);
      changed++;
    }
  }

  console.log(`\n${changed} file(s) modified`);
  if (changed > 0) {
    console.log("Review: ensure callers are async and exists() checks use await.");
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      "fix-test-hygiene-slice2a failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  });
}
