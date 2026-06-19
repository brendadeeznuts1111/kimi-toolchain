#!/usr/bin/env bun
/**
 * Scoped lint for check:fast --changed-only.
 * Delegates to scripts/lint.ts --files for a single entrypoint.
 *
 * Usage: bun run scripts/lint-changed.ts <files...>
 */

import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const files = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));

if (files.length === 0) {
  console.error("lint-changed: no files provided");
  process.exit(1);
}

const proc = Bun.spawn(["bun", "run", "scripts/lint.ts", "--files", ...files], {
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

const code = await proc.exited;
process.exit(code);
