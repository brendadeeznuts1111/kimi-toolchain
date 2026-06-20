#!/usr/bin/env bun
/**
 * Discovery hygiene lint — ensure rg/AI search indexes stay clean.
 *
 * Validates that `rg --files` does not include system caches, build artifacts,
 * or other directories that should be ignored via .rgignore / ~/.rgignore.
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

async function main(): Promise<number> {
  const proc = await $`rg --files`.quiet();
  const files = proc.stdout.toString().trim().split("\n").filter(Boolean);

  const leaks: string[] = [];
  for (const file of files) {
    for (const needle of FORBIDDEN_PATH_SUBSTRINGS) {
      if (file.includes(needle)) {
        leaks.push(file);
        break;
      }
    }
  }

  if (leaks.length > 0) {
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
    return 1;
  }

  console.log(`✓ Discovery lint clean — ${files.length} file(s) indexed, no ignored paths leaked`);
  return 0;
}

process.exit(await main());
