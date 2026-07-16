#!/usr/bin/env bun
/**
 * Changed-test runner — pre-commit (HEAD) vs pre-push (upstream) refs.
 *
 * Only runs test files whose static import graph reaches a changed source file.
 *
 * Usage:
 *   bun run scripts/test-changed.ts
 *   bun run scripts/test-changed.ts --push
 *   bun run scripts/test-changed.ts -- --smol
 *
 * Preset npm scripts add `--dots` for compact output; pass `--quiet` for failures-only.
 */
import { $ } from "bun";
import {
  bunTestArgsForChanged,
  parseForwardedBunTestArgs,
  runBunTest,
} from "../src/lib/test-runtime.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

async function resolvePushRef(): Promise<string> {
  const upstream = await $`git rev-parse --abbrev-ref @{upstream}`.cwd(REPO_ROOT).nothrow().quiet();
  if (upstream.exitCode === 0) {
    const ref = upstream.stdout.toString().trim();
    if (ref) return "@{upstream}";
  }

  for (const candidate of ["origin/main", "origin/master", "main"]) {
    const probe = await $`git rev-parse --verify ${candidate}`.cwd(REPO_ROOT).nothrow().quiet();
    if (probe.exitCode === 0) return candidate;
  }

  return "HEAD~1";
}

async function main(): Promise<number> {
  const push = Bun.argv.includes("--push");
  const changedRef = push ? await resolvePushRef() : "HEAD";
  const forwarded = parseForwardedBunTestArgs(Bun.argv.slice(2));
  const args = bunTestArgsForChanged(changedRef, { repoRoot: REPO_ROOT, forwarded });
  return runBunTest(REPO_ROOT, args, { source: push ? "test:changed:push" : "test:changed" });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("test-changed failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
