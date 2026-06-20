#!/usr/bin/env bun
/**
 * Changed-test runner — pre-commit (HEAD) vs pre-push (upstream) refs.
 *
 * Usage:
 *   bun run scripts/test-changed.ts
 *   bun run scripts/test-changed.ts --push
 */
import { join } from "path";
import { $ } from "bun";
import { DEFAULT_TEST_TIMEOUT_MS } from "../src/lib/test-gates.ts";
import { buildTestRunnerEnv } from "../src/lib/test-runtime.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function resolvePushRef(): Promise<string> {
  const upstream = await $`git rev-parse --abbrev-ref @{upstream}`
    .cwd(REPO_ROOT)
    .nothrow()
    .quiet();
  if (upstream.exitCode === 0) {
    const ref = upstream.stdout.toString().trim();
    if (ref) return "@{upstream}";
  }

  for (const candidate of ["origin/main", "origin/master", "main"]) {
    const probe = await $`git rev-parse --verify ${candidate}`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    if (probe.exitCode === 0) return candidate;
  }

  return "HEAD~1";
}

async function main(): Promise<number> {
  const push = Bun.argv.includes("--push");
  const changedRef = push ? await resolvePushRef() : "HEAD";
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      `--changed=${changedRef}`,
      "--timeout",
      String(DEFAULT_TEST_TIMEOUT_MS),
      "--isolate",
      "--parallel",
    ],
    {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
      env: buildTestRunnerEnv(),
    }
  );
  return await proc.exited;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("test-changed failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });