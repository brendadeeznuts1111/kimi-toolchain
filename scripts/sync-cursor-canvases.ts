#!/usr/bin/env bun
/**
 * Mirror docs/canvases/*.canvas.tsx → ~/.cursor/projects/<slug>/canvases/
 * for Cursor IDE sidebar pickup (managed dir is not linted; docs/canvases is SSOT).
 *
 * Usage:
 *   bun run sync:cursor-canvases
 *   bun run sync:cursor-canvases --check
 *   bun run sync:cursor-canvases --prune   # remove managed-only stale canvases
 */

import { join } from "path";
import { cursorProjectsDir } from "../src/lib/paths.ts";
import { pathExists, readText } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const SOURCE_DIR = join(REPO_ROOT, "docs/canvases");

function cursorWorkspaceSlug(absPath: string): string {
  return absPath.replace(/^\//, "").replace(/[/\\]/g, "-");
}

function managedCanvasesDir(repoRoot: string): string {
  return join(cursorProjectsDir(), cursorWorkspaceSlug(repoRoot), "canvases");
}

async function listSourceCanvases(): Promise<string[]> {
  const glob = new Bun.Glob("*.canvas.tsx");
  const names: string[] = [];
  for await (const rel of glob.scan({ cwd: SOURCE_DIR, onlyFiles: true })) {
    names.push(rel);
  }
  return names.sort();
}

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");
  const prune = Bun.argv.includes("--prune");
  const destDir = managedCanvasesDir(REPO_ROOT);
  const sources = await listSourceCanvases();

  if (sources.length === 0) {
    console.error("sync-cursor-canvases: no *.canvas.tsx in docs/canvases/");
    process.exit(1);
  }

  const stale: string[] = [];
  const missing: string[] = [];

  for (const name of sources) {
    const src = join(SOURCE_DIR, name);
    const dest = join(destDir, name);
    const srcText = await readText(src);

    if (!pathExists(dest)) {
      missing.push(name);
      if (!check) {
        await Bun.write(dest, srcText);
      }
      continue;
    }

    const destText = await readText(dest);
    if (destText !== srcText) {
      stale.push(name);
      if (!check) {
        await Bun.write(dest, srcText);
      }
    }
  }

  const pruned: string[] = [];
  if (prune && pathExists(destDir)) {
    const glob = new Bun.Glob("*.canvas.tsx");
    for await (const name of glob.scan({ cwd: destDir, onlyFiles: true })) {
      if (!sources.includes(name)) {
        pruned.push(name);
        if (!check) {
          await Bun.file(join(destDir, name)).delete();
        }
      }
    }
  }

  if (check) {
    const violations = [...missing, ...stale];
    if (violations.length > 0) {
      console.error("managed canvases stale or missing:\n");
      for (const name of violations) console.error(`  ${destDir}/${name}`);
      console.error("\nRun: bun run sync:cursor-canvases");
      process.exit(1);
    }
    if (prune && pruned.length > 0) {
      console.error("managed-only canvases to prune:\n");
      for (const name of pruned) console.error(`  ${destDir}/${name}`);
      console.error("\nRun: bun run sync:cursor-canvases --prune");
      process.exit(1);
    }
    console.log(`sync-cursor-canvases OK (${sources.length} files, ${destDir})`);
    return;
  }

  const updated = [...missing, ...stale];
  if (updated.length === 0 && pruned.length === 0) {
    console.log(`sync-cursor-canvases OK (no changes, ${sources.length} files)`);
    return;
  }

  if (updated.length > 0) {
    console.log(`sync-cursor-canvases copied ${updated.length} file(s) → ${destDir}`);
    for (const name of updated) console.log(`  ${name}`);
  }
  if (pruned.length > 0) {
    console.log(`sync-cursor-canvases pruned ${pruned.length} managed-only file(s)`);
    for (const name of pruned) console.log(`  ${name}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
