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
  log,
  findExecutable,
  resolveProjectRoot,
  sha256File,
  printToolBanner,
  printSection,
  buildDoctorReport,
  printDoctorReport,
} from "../lib/utils.ts";
import { detectSyncDrift } from "../lib/sync-hashes.ts";

// ── Config ───────────────────────────────────────────────────────────

const HOOKS = ["pre-commit", "pre-push"] as const;
const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");

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
fi

echo ""
echo "✓ Pre-push checks passed"
exit 0
`;

// ── Hook Installation ────────────────────────────────────────────────

async function installHooks(projectDir: string) {
  const gitPath = findExecutable("git");
  if (!gitPath) {
    log("error", "git not found in PATH. Install git first.");
    process.exit(1);
  }

  const gitDir = join(projectDir, ".git");
  if (!existsSync(gitDir)) {
    log("error", "Not a git repository. Run 'git init' first.");
    process.exit(1);
  }

  const hooksDir = join(gitDir, "hooks");
  ensureDir(hooksDir);

  const hookContent: Record<string, string> = {
    "pre-commit": PRE_COMMIT_HOOK,
    "pre-push": PRE_PUSH_HOOK,
  };

  for (const hook of HOOKS) {
    const hookPath = join(hooksDir, hook);
    await Bun.write(hookPath, hookContent[hook]);
    await $`chmod +x ${hookPath}`;
    log("info", `Installed ${hook} hook`);
  }

  // Configure git to use this hooks dir
  try {
    await $`git config core.hooksPath ${hooksDir}`.cwd(projectDir).quiet();
  } catch {
    // Ignore if git config fails
  }

  console.log("");
  log("info", "Hooks active. They will run on next commit/push.");
  console.log(
    "  pre-commit: blocks .env, format:check + lint + typecheck, warns on TODO/console.log"
  );
  console.log(
    "  pre-push:   guardian scan, R-Score gate (blocks F/D), check/test gate, mandatory bun run sync"
  );
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctorHooks(projectDir: string) {
  const hooksDir = join(projectDir, ".git", "hooks");
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
  try {
    const pkg = (await Bun.file(join(projectDir, "package.json")).json()) as { name?: string };
    if (pkg.name === "kimi-toolchain") {
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
  } catch {
    /* ignore */
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

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "install";
  const projectDir = await resolveProjectRoot(Bun.cwd);

  printToolBanner("Kimi Git Hooks");

  if (command === "install") {
    await installHooks(projectDir);
  } else if (command === "doctor") {
    const checks = await doctorHooks(projectDir);
    printDoctorReport(buildDoctorReport("Hook Health Check", checks));
  } else if (command === "fix") {
    printSection("Fixing Hooks");
    const checks = await doctorHooks(projectDir);
    const needsInstall = checks.some(
      (c) =>
        c.fixable && (c.name === "pre-commit" || c.name === "pre-push" || c.name === "hooks-dir")
    );
    if (needsInstall) {
      await installHooks(projectDir);
    } else {
      log("info", "All hooks properly installed");
    }
  } else if (command === "pre-commit") {
    console.log("── Pre-commit checks ─────────────────────────────────────────");
    const result = await $`git diff --cached --name-only`.cwd(projectDir).nothrow().quiet();
    const files = result.stdout.toString().trim().split("\n").filter(Boolean);
    if (files.length === 0) {
      log("warn", "No staged files");
    } else {
      log("info", `${files.length} staged file(s)`);
      const envFiles = files.filter((f) => /^\.env($|\.)/.test(f) && f !== ".env.example");
      if (envFiles.length > 0) {
        log("error", `.env files in staged changes: ${envFiles.join(", ")}`);
        process.exit(1);
      }
    }
  } else if (command === "pre-push") {
    console.log("── Pre-push checks (manual run) ──────────────────────────────");
    log("info", "Run 'git push' to trigger automatically, or use guardian/governance directly");
  } else {
    console.log("Commands:");
    console.log("  install        Install pre-commit and pre-push hooks");
    console.log("  doctor         Check hook installation health");
    console.log("  fix            Re-install missing/outdated hooks");
    console.log("  pre-commit     Run pre-commit checks manually");
    console.log("  pre-push       Info about pre-push checks");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Git hooks failed:", err.message);
  process.exit(1);
});
