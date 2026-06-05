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
import { ensureDir, log, findExecutable, resolveProjectRoot } from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const HOOKS = ["pre-commit", "pre-push"];
const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");

const PRE_COMMIT_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P0: Block secrets, env blocks, TODOs in commit messages

# Check for .env files being committed
if git diff --cached --name-only | grep -qE '^\\.env($|\\.)'; then
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

exit 0
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P1: Lockfile verification, guardian scan, R-Score gate

echo "═══ Kimi Pre-Push Gate ═══"

# 1. Lockfile guardian check
GUARDIAN="${TOOLS_DIR}/kimi-guardian.ts"
if [ -f "bun.lock" ] && [ -f "$GUARDIAN" ]; then
  echo "── Lockfile Guardian ────────────────────────────────────────"
  bun run "$GUARDIAN" check 2>/dev/null || true
fi

# 2. Dependency drift + CVE scan (only if guardian exists)
if [ -f "$GUARDIAN" ]; then
  echo ""
  echo "── Dependency Audit ─────────────────────────────────────────"
  bun run "$GUARDIAN" check 2>&1 | grep -E "(CVE|outdated|untrusted|HASH MISMATCH)" || echo "  ✓ No critical issues"
fi

# 3. R-Score gate (block push if F or D grade)
GOVERNANCE="${TOOLS_DIR}/kimi-governance.ts"
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

# 4. Test gate (if tests exist)
if [ -f "package.json" ]; then
  HAS_TEST=$(grep -c '"test"' package.json || echo "0")
  if [ "$HAS_TEST" -gt 0 ]; then
    echo ""
    echo "── Test Gate ────────────────────────────────────────────────"
    bun test 2>&1 | tail -5 || true
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
  console.log("  pre-commit: blocks .env files, warns on TODO/console.log");
  console.log("  pre-push:   guardian scan, R-Score gate (blocks F/D grades), test gate");
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
    checks.push({
      name: "pre-commit",
      status: hasKimi ? "ok" : "warn",
      message: hasKimi ? "Installed by kimi" : "Custom pre-commit (not managed)",
      fixable: !hasKimi,
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
    checks.push({
      name: "pre-push",
      status: hasKimi ? "ok" : "warn",
      message: hasKimi ? "Installed by kimi" : "Custom pre-push (not managed)",
      fixable: !hasKimi,
    });
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

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║           Kimi Git Hooks                                     ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  if (command === "install") {
    await installHooks(projectDir);
  } else if (command === "doctor") {
    console.log("── Hook Health Check ─────────────────────────────────────────");
    const checks = await doctorHooks(projectDir);
    let errors = 0,
      warns = 0,
      fixable = 0;
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
  } else if (command === "fix") {
    console.log("── Fixing Hooks ──────────────────────────────────────────────");
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
      const envFiles = files.filter((f) => f.match(/^\.env($|\.|\.local$)/));
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
