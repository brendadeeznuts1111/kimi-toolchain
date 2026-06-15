#!/usr/bin/env bun
/**
 * kimi-githooks — Install and manage git hooks
 * P0: pre-commit (env blocks, TODO checks)
 * P1: pre-push (lockfile verify, guardian scan, R-Score gate)
 *
 * Usage:
 *   kimi-githooks [install|doctor|fix|pre-commit|pre-push]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import {
  ensureDir,
  findExecutable,
  resolveProjectRoot,
  sha256File,
  readPackageJson,
} from "../lib/utils.ts";

import { detectSyncDrift } from "../lib/sync-hashes.ts";
import { toolsDir } from "../lib/paths.ts";
import { logDecision } from "../lib/decision-ledger.ts";
import { ensureProcessTrace } from "../lib/effect/trace-context.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { ensureQuietEnv } from "../lib/quiet-mode.ts";
import { runPreCommitGates, runPreCommitPolicy, runPrePushGates } from "../lib/hook-gates.ts";

const logger = createLogger(Bun.argv, "kimi-githooks");

const HOOKS = ["pre-commit", "pre-push"] as const;
const TOOLS_DIR = toolsDir();

async function resolveHooksDir(projectDir: string): Promise<string> {
  const result = await $`git rev-parse --git-path hooks`.cwd(projectDir).nothrow().quiet();
  const resolved = result.stdout.toString().trim();
  return result.exitCode === 0 && resolved ? resolved : join(projectDir, ".git", "hooks");
}

const PRE_COMMIT_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P0: Block secrets; P1: quality gates (quiet when KIMI_QUIET=1 or KIMI_AGENT_SESSION)

if [ -n "$KIMI_AGENT_SESSION" ]; then export KIMI_QUIET=1; fi

if [ -f "src/bin/kimi-githooks.ts" ]; then
  GITHOOKS="bun run src/bin/kimi-githooks.ts"
elif [ -f "${TOOLS_DIR}/kimi-githooks.ts" ]; then
  GITHOOKS="bun run ${TOOLS_DIR}/kimi-githooks.ts"
else
  echo "✗ kimi-githooks not found — run: kimi-githooks install"
  exit 1
fi

$GITHOOKS run-gates pre-commit || exit 1
exit 0
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P1: guardian, R-Score, check:fast (KIMI_PRE_PUSH_FULL=1 for full check)

if [ -n "$KIMI_AGENT_SESSION" ]; then export KIMI_QUIET=1; fi

if [ -f "src/bin/kimi-githooks.ts" ]; then
  GITHOOKS="bun run src/bin/kimi-githooks.ts"
elif [ -f "${TOOLS_DIR}/kimi-githooks.ts" ]; then
  GITHOOKS="bun run ${TOOLS_DIR}/kimi-githooks.ts"
else
  echo "✗ kimi-githooks not found — run: kimi-githooks install"
  exit 1
fi

$GITHOOKS run-gates pre-push || exit 1
exit 0
`;

// ── Hook Installation ────────────────────────────────────────────────

async function installHooks(projectDir: string): Promise<number> {
  const gitPath = findExecutable("git");
  if (!gitPath) {
    logger.error("git not found in PATH. Install git first.");
    return 1;
  }

  const gitDir = join(projectDir, ".git");
  if (!existsSync(gitDir)) {
    logger.error("Not a git repository. Run 'git init' first.");
    return 1;
  }

  const hooksDir = await resolveHooksDir(projectDir);
  ensureDir(hooksDir);

  const hookContent: Record<string, string> = {
    "pre-commit": PRE_COMMIT_HOOK,
    "pre-push": PRE_PUSH_HOOK,
  };

  for (const hook of HOOKS) {
    const hookPath = join(hooksDir, hook);
    await Bun.write(hookPath, hookContent[hook]);
    await $`chmod +x ${hookPath}`;
    logger.info(`Installed ${hook} hook`);
  }

  // Configure git to use this hooks dir
  try {
    await $`git config core.hooksPath ${hooksDir}`.cwd(projectDir).quiet();
  } catch {
    // Ignore if git config fails
  }

  logger.info("Hooks active. They will run on next commit/push.");
  logger.info(
    "  pre-commit: blocks .env, format:check + lint + typecheck, warns on TODO/console.log"
  );
  logger.info("  pre-push:   guardian, R-Score, check:fast (KIMI_PRE_PUSH_FULL=1 for full), sync");

  try {
    const trace = ensureProcessTrace();
    await logDecision({
      action: "hook-register",
      trigger: { traceId: trace.traceId, hookName: HOOKS.join(",") },
      outcome: {
        result: "success",
        verifiedAt: new Date().toISOString(),
        proof: { type: "health-probe", detail: `Installed hooks in ${hooksDir}` },
      },
      metadata: { projectDir, hooksDir },
    });
  } catch {
    // best-effort decision logging
  }

  return 0;
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctorHooks(projectDir: string) {
  const hooksDir = await resolveHooksDir(projectDir);
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // Check git repo
  const gitDir = join(projectDir, ".git");
  if (!existsSync(gitDir)) {
    checks.push({
      name: "git-repo",
      status: "error",
      message: "Not a git repository",
      fixable: false,
    });
    return checks;
  }
  checks.push({ name: "git-repo", status: "ok", message: "Git repository found", fixable: false });

  // Check hooks dir
  if (!existsSync(hooksDir)) {
    checks.push({
      name: "hooks-dir",
      status: "error",
      message: "Hooks directory missing",
      fixable: true,
    });
  } else {
    checks.push({
      name: "hooks-dir",
      status: "ok",
      message: "Hooks directory exists",
      fixable: false,
    });
  }

  // Check pre-commit
  const preCommitPath = join(hooksDir, "pre-commit");
  if (!existsSync(preCommitPath)) {
    checks.push({
      name: "pre-commit",
      status: "warn",
      message: "pre-commit hook not installed",
      fixable: true,
    });
  } else {
    const content = await Bun.file(preCommitPath).text();
    const hasKimi = content.includes("kimi-githooks");
    const hasQuality = content.includes("format:check") && content.includes("typecheck");
    checks.push({
      name: "pre-commit",
      status: hasKimi && hasQuality ? "ok" : hasKimi ? "warn" : "warn",
      message: hasKimi
        ? hasQuality
          ? "Installed with format/lint/typecheck gates"
          : "Installed but missing quality gates"
        : "Custom pre-commit (not managed)",
      fixable: !hasKimi || !hasQuality,
    });
  }

  // Check pre-push
  const prePushPath = join(hooksDir, "pre-push");
  if (!existsSync(prePushPath)) {
    checks.push({
      name: "pre-push",
      status: "warn",
      message: "pre-push hook not installed",
      fixable: true,
    });
  } else {
    const content = await Bun.file(prePushPath).text();
    const hasKimi = content.includes("kimi-githooks");
    const hasQuality = content.includes("Quality Gate");
    const hasRepoFirst = content.includes("src/bin/kimi-governance.ts");
    const hasDesktopSync = content.includes("Desktop Sync (mandatory)");
    const prePushOk = hasKimi && hasQuality && hasRepoFirst && hasDesktopSync;
    checks.push({
      name: "pre-push",
      status: prePushOk ? "ok" : hasKimi ? "warn" : "warn",
      message: hasKimi
        ? prePushOk
          ? "Installed with repo-first tools, quality gate, mandatory desktop sync"
          : "Installed but stale template — run kimi-githooks fix"
        : "Custom pre-push (not managed)",
      fixable: !prePushOk,
    });
  }

  // Desktop tool drift (kimi-toolchain repo only)
  const pkg = await readPackageJson(
    projectDir,
    (p): p is { name?: string } => typeof p === "object" && p !== null && "name" in p
  );
  if (pkg?.name === "kimi-toolchain") {
    const drift = await detectSyncDrift(projectDir);
    if (drift.synced) {
      checks.push({
        name: "desktop-sync",
        status: "ok",
        message: "Desktop tools match repo",
        fixable: false,
      });
    } else {
      const count = drift.drifted.length + drift.missing.length;
      checks.push({
        name: "desktop-sync",
        status: "warn",
        message: `${count} desktop file(s) drifted — run bun run sync`,
        fixable: true,
      });
    }

    const repoGov = join(projectDir, "src/bin/kimi-governance.ts");
    const desktopGov = join(TOOLS_DIR, "kimi-governance.ts");
    if (existsSync(repoGov) && existsSync(desktopGov)) {
      const [repoHash, desktopHash] = await Promise.all([
        sha256File(repoGov),
        sha256File(desktopGov),
      ]);
      checks.push({
        name: "governance-parity",
        status: repoHash === desktopHash ? "ok" : "warn",
        message:
          repoHash === desktopHash
            ? "kimi-governance.ts matches desktop"
            : "kimi-governance.ts differs from desktop — run bun run sync",
        fixable: repoHash !== desktopHash,
      });
    }
  }

  // Check core.hooksPath
  try {
    const result = await $`git config core.hooksPath`.cwd(projectDir).nothrow().quiet();
    const hooksPath = result.stdout.toString().trim();
    if (hooksPath && hooksPath !== hooksDir) {
      checks.push({
        name: "hooks-path",
        status: "warn",
        message: `core.hooksPath set to ${hooksPath} (may override local hooks)`,
        fixable: true,
      });
    } else {
      checks.push({
        name: "hooks-path",
        status: "ok",
        message: "core.hooksPath correctly configured",
        fixable: false,
      });
    }
  } catch {
    checks.push({
      name: "hooks-path",
      status: "ok",
      message: "core.hooksPath not set (using default)",
      fixable: false,
    });
  }

  return checks;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "install";
  const projectDir = await resolveProjectRoot(Bun.cwd);

  logger.banner("Kimi Git Hooks");

  if (command === "install") {
    return installHooks(projectDir);
  }
  if (command === "doctor") {
    const checks = await doctorHooks(projectDir);
    return logger.runDoctor("Hook Health Check", checks);
  }
  if (command === "fix") {
    logger.section("Fixing Hooks");
    const checks = await doctorHooks(projectDir);
    const needsInstall = checks.some(
      (c) =>
        c.fixable && (c.name === "pre-commit" || c.name === "pre-push" || c.name === "hooks-dir")
    );
    if (needsInstall) {
      return installHooks(projectDir);
    }
    logger.info("All hooks properly installed");
    return 0;
  }
  if (command === "pre-commit") {
    logger.section("Pre-commit checks");
    const policy = await runPreCommitPolicy(projectDir);
    if (policy !== 0) return policy;
    return runPreCommitGates(projectDir);
  }
  if (command === "run-gates") {
    ensureQuietEnv();
    const hook = args[1];
    if (hook === "pre-commit") {
      const policy = await runPreCommitPolicy(projectDir);
      if (policy !== 0) return policy;
      return runPreCommitGates(projectDir);
    }
    if (hook === "pre-push") {
      return runPrePushGates(projectDir);
    }
    logger.error("Usage: run-gates <pre-commit|pre-push>");
    return 1;
  }
  if (command === "pre-push") {
    logger.section("Pre-push checks (manual run)");
    logger.info("Run 'git push' to trigger automatically, or use guardian/governance directly");
    return 0;
  }

  logger.section("Commands");
  logger.info("  install        Install pre-commit and pre-push hooks");
  logger.info("  doctor         Check hook installation health");
  logger.info("  fix            Re-install missing/outdated hooks");
  logger.info("  pre-commit     Run pre-commit gates manually");
  logger.info("  pre-push       Info about pre-push checks");
  logger.info("  run-gates      Hook gate runner (pre-commit | pre-push)");
  logger.info("  Env: KIMI_QUIET=1 silences success; KIMI_PRE_PUSH_FULL=1 runs full check on push");
  return 0;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-githooks", logger }
  );
  process.exit(exitCode);
}
