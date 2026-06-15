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
import { verifySyncManifest } from "../lib/sync-manifest.ts";
import { toolsDir } from "../lib/paths.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-githooks");

const HOOKS = ["pre-commit", "pre-push"] as const;
const TOOLS_DIR = toolsDir();

const PRE_COMMIT_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P0: Block secrets, env blocks, TODOs in commit messages

# Check for .env files being committed (.env.example is allowed)
ENV_BLOCKED=$(git diff --cached --name-only | grep -E '^\\.env($|\\.)' | grep -v '^\\.env\\.example$' || true)
if [ -n "$ENV_BLOCKED" ]; then
  echo "✗ Commit blocked: .env file detected in staged changes"
  echo "  Use Bun.secrets or a vault. Never commit .env files."
  exit 1
fi

# Check for TODO/FIXME in staged files (not test files)
TODO_COUNT=$(git diff --cached --name-only | grep -v '\\.test\\.' | grep -v '\\.spec\\.' | xargs -I {} git diff --cached -- {} 2>/dev/null | grep -c '^+.*TODO\\|FIXME' || true)
if [ "$TODO_COUNT" -gt 0 ]; then
  echo "⚠ $TODO_COUNT TODO/FIXME found in staged non-test files"
  echo "  Commit allowed, but consider addressing before merge."
fi

# Check for console.log in staged .ts files (not .test.ts)
LOG_COUNT=$(git diff --cached --name-only | grep '\\.ts$' | grep -v '\\.test\\.' | grep -v '\\.spec\\.' | xargs -I {} git diff --cached -- {} 2>/dev/null | grep -c '^+.*console\\.log' || true)
if [ "$LOG_COUNT" -gt 0 ]; then
  echo "⚠ $LOG_COUNT console.log found in staged .ts files"
  echo "  Consider using a proper logger or removing debug output."
fi

# Quality gates (when package.json defines scripts)
if [ -f package.json ]; then
  if grep -q '"format:check"' package.json 2>/dev/null; then
    echo "── Format check ─────────────────────────────────────────────"
    bun run format:check || exit 1
  fi
  if grep -q '"lint"' package.json 2>/dev/null; then
    echo "── Lint ─────────────────────────────────────────────────────"
    bun run lint || exit 1
  fi
  if grep -q '"typecheck"' package.json 2>/dev/null; then
    echo "── Type check ───────────────────────────────────────────────"
    bun run typecheck || exit 1
  fi
  if grep -q '"test:fast"' package.json 2>/dev/null; then
    echo "── Unit tests (fast) ────────────────────────────────────────"
    bun run test:fast || exit 1
  fi
fi

exit 0
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P1: Lockfile verification, guardian scan, R-Score gate

# Git streams hook files while they execute. The pre-push gate is long-running and
# may install/sync hooks as part of validation, so execute a temp snapshot.
if [ -z "\${KIMI_HOOK_SNAPSHOT:-}" ]; then
  KIMI_HOOK_TMP="\${TMPDIR:-/tmp}/kimi-pre-push.$$"
  cp "$0" "$KIMI_HOOK_TMP" || exit 1
  chmod +x "$KIMI_HOOK_TMP" || exit 1
  KIMI_HOOK_SNAPSHOT="$KIMI_HOOK_TMP" exec "$KIMI_HOOK_TMP" "$@"
fi

if [ -n "\${KIMI_HOOK_SNAPSHOT:-}" ]; then
  trap 'rm -f "$KIMI_HOOK_SNAPSHOT"' EXIT
fi

echo "═══ Kimi Pre-Push Gate ═══"

# Prefer repo src when developing kimi-toolchain
if [ -f "src/bin/kimi-guardian.ts" ] && [ -f "package.json" ]; then
  GUARDIAN="src/bin/kimi-guardian.ts"
else
  GUARDIAN="${TOOLS_DIR}/kimi-guardian.ts"
fi

if [ -f "src/bin/kimi-governance.ts" ] && [ -f "package.json" ]; then
  GOVERNANCE="src/bin/kimi-governance.ts"
else
  GOVERNANCE="${TOOLS_DIR}/kimi-governance.ts"
fi

# 1. Supply Chain Security (guardian: lockfile + dependency audit)
if [ -f "$GUARDIAN" ]; then
  echo "── Supply Chain Security ──────────────────────────────────"
  bun run "$GUARDIAN" check 2>&1 | grep -E "(CVE|outdated|untrusted|HASH MISMATCH)" || echo "  ✓ No critical issues"
fi

# 2. R-Score gate (block push if F or D grade)
if [ -f "$GOVERNANCE" ]; then
  echo ""
  echo "── R-Score Gate ─────────────────────────────────────────────"
  SCORE_OUTPUT=$(bun run "$GOVERNANCE" score 2>&1)
  echo "$SCORE_OUTPUT" | grep -E "Grade:|Breakdown:"

  GRADE=$(echo "$SCORE_OUTPUT" | grep "Grade:" | sed 's/.*Grade: \\([A-F]\\).*/\\1/')
  if [ "$GRADE" = "F" ] || [ "$GRADE" = "D" ]; then
    echo ""
    echo "✗ PUSH BLOCKED: R-Score is $GRADE. Address governance gaps first."
    echo "  Run: bun run $GOVERNANCE fix"
    exit 1
  fi
fi

# 4. Quality gate (format, lint, test)
if [ -f "package.json" ]; then
  echo ""
  echo "── Quality Gate ─────────────────────────────────────────────"
  if grep -q '"check"' package.json 2>/dev/null; then
    bun run check || exit 1
  else
    if grep -q '"format:check"' package.json 2>/dev/null; then
      bun run format:check || exit 1
    fi
    if grep -q '"lint"' package.json 2>/dev/null; then
      bun run lint || exit 1
    fi
    if grep -q '"test"' package.json 2>/dev/null; then
      bun test || exit 1
    fi
  fi
fi

# 5. Workspace verify (kimi-toolchain only)
if [ -f "package.json" ] && grep -q '"name": "kimi-toolchain"' package.json 2>/dev/null; then
  echo ""
  echo "── Workspace Verify ─────────────────────────────────────────"
  if [ -f "scripts/verify-workspace.sh" ]; then
    bash scripts/verify-workspace.sh || exit 1
  else
    bun run src/bin/kimi-doctor.ts workspace verify || exit 1
  fi
fi

# 6. Desktop sync (mandatory for kimi-toolchain — keeps ~/.kimi-code/ on pushed HEAD)
if [ -f "package.json" ] && grep -q '"name": "kimi-toolchain"' package.json 2>/dev/null; then
  echo ""
  echo "── Desktop Sync (mandatory) ─────────────────────────────────"
  if [ -f "scripts/sync-to-desktop.ts" ]; then
    bun run scripts/sync-to-desktop.ts || exit 1
  elif grep -q '"sync"' package.json 2>/dev/null; then
    bun run sync || exit 1
  else
    echo "✗ PUSH BLOCKED: kimi-toolchain sync script missing"
    exit 1
  fi

  echo ""
  echo "── Sync Manifest Verify ─────────────────────────────────────"
  if grep -q '"sync:verify"' package.json 2>/dev/null; then
    bun run sync:verify || exit 1
  elif [ -f "scripts/sync-manifest.ts" ]; then
    bun run scripts/sync-manifest.ts --verify || exit 1
  else
    echo "✗ PUSH BLOCKED: sync manifest verifier missing"
    exit 1
  fi
fi

echo ""
echo "✓ Pre-push checks passed"
exit 0
`;

// ── Hook Installation ────────────────────────────────────────────────

async function resolveGitPath(projectDir: string, path: string): Promise<string | null> {
  const result = await $`git rev-parse --git-path ${path}`.cwd(projectDir).nothrow().quiet();
  if (result.exitCode !== 0) return null;
  const resolved = result.stdout.toString().trim();
  if (!resolved) return null;
  return resolved.startsWith("/") ? resolved : join(projectDir, resolved);
}

async function installHooks(projectDir: string): Promise<number> {
  const gitPath = findExecutable("git");
  if (!gitPath) {
    logger.error("git not found in PATH. Install git first.");
    return 1;
  }

  const hooksDir = await resolveGitPath(projectDir, "hooks");
  if (!hooksDir) {
    logger.error("Not a git repository. Run 'git init' first.");
    return 1;
  }

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
  logger.info(
    "  pre-push:   guardian scan, R-Score gate (blocks F/D), check/test gate, mandatory bun run sync + sync:verify"
  );
  return 0;
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctorHooks(projectDir: string) {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // Check git repo
  const hooksDir = await resolveGitPath(projectDir, "hooks");
  if (!hooksDir) {
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
    const hasSyncManifest = content.includes("Sync Manifest Verify");
    const hasSnapshotGuard = content.includes("KIMI_HOOK_SNAPSHOT");
    const prePushOk =
      hasKimi &&
      hasQuality &&
      hasRepoFirst &&
      hasDesktopSync &&
      hasSyncManifest &&
      hasSnapshotGuard;
    checks.push({
      name: "pre-push",
      status: prePushOk ? "ok" : hasKimi ? "warn" : "warn",
      message: hasKimi
        ? prePushOk
          ? "Installed with repo-first tools, quality gate, mandatory desktop sync, sync manifest verify, snapshot guard"
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

    const manifest = await verifySyncManifest(projectDir);
    checks.push({
      name: "sync-manifest",
      status: manifest.ok ? "ok" : "warn",
      message: manifest.ok
        ? "Sync manifest hashes match repo and desktop runtime"
        : `Manifest needs regeneration (${manifest.changedHashes.length} changed hash(es), ${manifest.missingHashes.length} missing hash(es), ${manifest.drift.drifted.length + manifest.drift.missing.length} desktop drift item(s))`,
      fixable: !manifest.ok,
    });

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
    const result = await $`git diff --cached --name-only`.cwd(projectDir).nothrow().quiet();
    const files = result.stdout.toString().trim().split("\n").filter(Boolean);
    if (files.length === 0) {
      logger.warn("No staged files");
    } else {
      logger.info(`${files.length} staged file(s)`);
      const envFiles = files.filter((f) => /^\.env($|\.)/.test(f) && f !== ".env.example");
      if (envFiles.length > 0) {
        logger.error(`.env files in staged changes: ${envFiles.join(", ")}`);
        return 1;
      }
    }
    return 0;
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
  logger.info("  pre-commit     Run pre-commit checks manually");
  logger.info("  pre-push       Info about pre-push checks");
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
