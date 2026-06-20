import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import {
  analyzePreCommitHook,
  analyzePrePushHook,
  describeMissingHookMarkers,
  renderPreCommitHook,
  renderPrePushHook,
} from "../src/lib/githook-templates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("githook templates", () => {
  test("pre-commit template includes the managed fast quality gates", () => {
    const hook = renderPreCommitHook();
    const analysis = analyzePreCommitHook(hook);

    expect(analysis.ok).toBe(true);
    expect(hook).toContain("bun run format:check");
    expect(hook).toContain("bun run lint");
    expect(hook).toContain("bun run typecheck");
    expect(hook).toContain("bun run test:fast");
  });

  test("pre-push skips expensive gates when Git supplies no refs", () => {
    const hook = renderPrePushHook("/tmp/kimi tools");
    const noRefSkipIndex = hook.indexOf("No refs to push; skipping pre-push checks");
    const firstExpensiveGateIndex = hook.indexOf("Supply Chain Security");

    expect(noRefSkipIndex).toBeGreaterThan(0);
    expect(firstExpensiveGateIndex).toBeGreaterThan(noRefSkipIndex);
    expect(hook).toContain("PUSH_REFS=$(cat)");
  });

  test("pre-push skips delete-only pushes before local quality gates", () => {
    const hook = renderPrePushHook("/tmp/kimi-tools");
    const deleteSkipIndex = hook.indexOf("Only deleted refs; skipping local quality gates");
    const qualityGateIndex = hook.indexOf("Quality Gate");

    expect(deleteSkipIndex).toBeGreaterThan(0);
    expect(qualityGateIndex).toBeGreaterThan(deleteSkipIndex);
    expect(hook).toContain("awk '$2 !~ /^0+$/ { print }'");
  });

  test("pre-push defaults to the fast quality gate with an explicit full override", () => {
    const hook = renderPrePushHook("/tmp/kimi-tools");
    const fastGateIndex = hook.indexOf("bun run check:fast --skip-tests");
    const changedTestsIndex = hook.indexOf("bun test --changed=HEAD --isolate --parallel");
    const fullGateIndex = hook.indexOf("bun run check || exit 1");

    expect(hook).toContain("KIMI_PRE_PUSH_FULL");
    expect(fastGateIndex).toBeGreaterThan(0);
    expect(changedTestsIndex).toBeGreaterThan(0);
    expect(fullGateIndex).toBeGreaterThan(0);
    expect(fastGateIndex).toBeGreaterThan(fullGateIndex);
    expect(changedTestsIndex).toBeGreaterThan(fastGateIndex);
    expect(analyzePrePushHook(hook).ok).toBe(true);
  });

  test("pre-push analyzer reports stale managed templates by missing behavior", () => {
    const staleHook = `#!/bin/sh
# Auto-installed by kimi-githooks
KIMI_HOOK_SNAPSHOT=1
echo "── Quality Gate ──"
bun run check
`;

    const analysis = analyzePrePushHook(staleHook);
    const missing = describeMissingHookMarkers(analysis);

    expect(analysis.managed).toBe(true);
    expect(analysis.ok).toBe(false);
    expect(missing).toContain("no-ref push skip");
    expect(missing).toContain("fast quality gate");
  });

  test("rendered hook scripts are valid POSIX shell syntax", async () => {
    const tmpDir = artifactPath(REPO_ROOT, "tmp", `githooks-${Bun.randomUUIDv7()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const preCommit = join(tmpDir, "pre-commit");
      const prePush = join(tmpDir, "pre-push");
      await Bun.write(preCommit, renderPreCommitHook());
      await Bun.write(prePush, renderPrePushHook("/tmp/kimi tools"));

      const preCommitSyntax = await $`/bin/sh -n ${preCommit}`.nothrow().quiet();
      const prePushSyntax = await $`/bin/sh -n ${prePush}`.nothrow().quiet();

      expect(preCommitSyntax.exitCode).toBe(0);
      expect(prePushSyntax.exitCode).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
