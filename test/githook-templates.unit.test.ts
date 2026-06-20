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
import { REPO_ROOT } from "./helpers.ts";

describe("githook templates", () => {
  test("pre-commit template delegates to run-gates pre-commit", () => {
    const hook = renderPreCommitHook();
    const analysis = analyzePreCommitHook(hook);

    expect(analysis.ok).toBe(true);
    expect(hook).toContain("run-gates pre-commit");
    expect(hook).toContain("src/bin/kimi-githooks.ts");
  });

  test("pre-push skips expensive gates when Git supplies no refs", () => {
    const hook = renderPrePushHook("/tmp/kimi-tools");
    const noRefSkipIndex = hook.indexOf("No refs to push; skipping pre-push checks");
    const delegateIndex = hook.indexOf("exec bun run src/bin/kimi-githooks.ts run-gates pre-push");

    expect(noRefSkipIndex).toBeGreaterThan(0);
    expect(delegateIndex).toBeGreaterThan(noRefSkipIndex);
    expect(hook).toContain("PUSH_REFS=$(cat)");
  });

  test("pre-push skips delete-only pushes before run-gates delegate", () => {
    const hook = renderPrePushHook("/tmp/kimi-tools");
    const deleteSkipIndex = hook.indexOf("Only deleted refs; skipping local quality gates");
    const delegateIndex = hook.indexOf("exec bun run src/bin/kimi-githooks.ts run-gates pre-push");

    expect(deleteSkipIndex).toBeGreaterThan(0);
    expect(delegateIndex).toBeGreaterThan(deleteSkipIndex);
    expect(hook).toContain("awk '$2 !~ /^0+$/ { print }'");
  });

  test("pre-push keeps snapshot guard and run-gates delegate", () => {
    const hook = renderPrePushHook("/tmp/kimi-tools");

    expect(hook).toContain("KIMI_HOOK_SNAPSHOT");
    expect(hook).toContain("run-gates pre-push");
    expect(analyzePrePushHook(hook).ok).toBe(true);
  });

  test("pre-push analyzer reports stale managed templates by missing behavior", () => {
    const staleHook = `#!/bin/sh
# Auto-installed by kimi-githooks
KIMI_HOOK_SNAPSHOT=1
bun run check
`;

    const analysis = analyzePrePushHook(staleHook);
    const missing = describeMissingHookMarkers(analysis);

    expect(analysis.managed).toBe(true);
    expect(analysis.ok).toBe(false);
    expect(missing).toContain("no-ref push skip");
    expect(missing).toContain("run-gates delegate");
  });

  test("pre-push-portal hook is valid POSIX shell syntax", async () => {
    const hookPath = join(REPO_ROOT, "scripts", "pre-push-portal.sh");
    const syntax = await $`/bin/sh -n ${hookPath}`.nothrow().quiet();
    expect(syntax.exitCode).toBe(0);
    const content = await Bun.file(hookPath).text();
    expect(content).not.toContain("bun run test:portal-convergence");
    expect(content).toContain("build:portal:gate");
    expect(content).not.toContain("build:portal:local:json");
  });

  test("hooks-portal-install installs convergence guard only", async () => {
    const installPath = join(REPO_ROOT, "scripts", "hooks-portal-install.sh");
    const syntax = await $`bash -n ${installPath}`.nothrow().quiet();
    expect(syntax.exitCode).toBe(0);
    const content = await Bun.file(installPath).text();
    expect(content).toContain("convergence pre-push guard only");
    expect(content).toContain("kimi-githooks");
    expect(content).toContain('echo "  removed ${hook}"');
    expect(content).toContain("portal hook install skipped");
    expect(content).toContain("pre-commit");
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
