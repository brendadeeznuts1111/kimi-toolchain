#!/usr/bin/env bun
/**
 * Discovery hygiene lint — ensure rg/AI search indexes stay clean.
 *
 * Validates that `rg --files` does not include system caches, build artifacts,
 * or other directories that should be ignored via .rgignore / ~/.rgignore.
 *
 * Also verifies that no tracked source file under src/, test/, bench/, examples/,
 * scripts/, or docs/ is accidentally hidden by a broad ignore pattern.
 */

import { $ } from "bun";

const FORBIDDEN_PATH_SUBSTRINGS = [
  "/Applications/",
  "/Library/Caches/",
  ".bun/install/cache/",
  ".kimi-artifacts/",
  "/node_modules/",
  "/.npm/",
  "/.cache/",
  "/.cargo/",
  "/.rustup/",
  "/.pyenv/",
  "/.asdf/",
  "/.conan/",
  "/.docker/",
  "/go/pkg/",
];

const SOURCE_PREFIXES = ["src/", "test/", "bench/", "examples/", "scripts/", "docs/"];

function isSourcePath(path: string): boolean {
  return SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function main(): Promise<number> {
  const [rgProc, gitProc] = await Promise.all([
    // Include hidden files so the check can verify that tracked dotfiles (e.g.
    // .gitignore, .env.example) are not accidentally hidden by broad patterns.
    // Keep .git/ itself excluded to avoid counting the repository metadata tree.
    $`rg --files --hidden --glob '!.git'`.quiet(),
    $`git ls-files`.quiet(),
  ]);

  const files = rgProc.stdout.toString().trim().split("\n").filter(Boolean);
  const indexed = new Set(files);

  const tracked = gitProc.stdout.toString().trim().split("\n").filter(Boolean).filter(isSourcePath);

  const leaks: string[] = [];
  for (const file of files) {
    for (const needle of FORBIDDEN_PATH_SUBSTRINGS) {
      if (file.includes(needle)) {
        leaks.push(file);
        break;
      }
    }
  }

  const hidden: string[] = [];
  for (const file of tracked) {
    if (!indexed.has(file)) {
      hidden.push(file);
    }
  }

  let failed = false;

  if (leaks.length > 0) {
    failed = true;
    console.error(
      `✗ Discovery lint failed: ${leaks.length} ignored path(s) leaked into rg --files`
    );
    for (const leak of leaks.slice(0, 20)) {
      console.error(`  - ${leak}`);
    }
    if (leaks.length > 20) {
      console.error(`  ... and ${leaks.length - 20} more`);
    }
    console.error("Add the directory to .rgignore (project) or ~/.rgignore (global).");
  }

  if (hidden.length > 0) {
    failed = true;
    console.error(
      `✗ Discovery lint failed: ${hidden.length} tracked source file(s) hidden from rg --files`
    );
    for (const file of hidden.slice(0, 20)) {
      console.error(`  - ${file}`);
    }
    if (hidden.length > 20) {
      console.error(`  ... and ${hidden.length - 20} more`);
    }
    console.error(
      "A .rgignore or .gitignore pattern is too broad. Use a leading slash (e.g. /dirname/) for root-level directories."
    );
  }

  if (failed) {
    return 1;
  }

  console.log(
    `✓ Discovery lint clean — ${files.length} file(s) indexed, no ignored paths leaked, no tracked source hidden`
  );
  return 0;
}

process.exit(await main());
