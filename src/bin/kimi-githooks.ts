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
import { pathExists } from "../lib/bun-io.ts";
import { join } from "path";
import { ensureDir, resolveProjectRoot, sha256File, readPackageJson } from "../lib/utils.ts";

import { detectSyncDrift } from "../lib/sync-hashes.ts";
import { verifySyncManifest } from "../lib/sync-manifest.ts";
import { toolsDir } from "../lib/paths.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  GIT_HOOK_NAMES,
  type GitHookName,
  analyzePreCommitHook,
  analyzePrePushHook,
  describeMissingHookMarkers,
  renderPreCommitHook,
  renderPrePushHook,
} from "../lib/githook-templates.ts";
import {
  runPreCommitDryRun,
  runPreCommitGates,
  runPreCommitPolicy,
  runPrePushDryRun,
  runPrePushGates,
} from "../lib/hook-gates.ts";
import { profileMatchesGitIdentity, type GitIdentity } from "../lib/identity-matrix.ts";

const logger = createLogger(Bun.argv, "kimi-githooks");

export interface HookHealthCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export function buildGlobalHooksPathCheck(
  globalHooksPath: string | null | undefined
): HookHealthCheck {
  const hooksPath = globalHooksPath?.trim();
  if (!hooksPath) {
    return {
      name: "global-hooks-path",
      status: "ok",
      message: "global core.hooksPath unset",
      fixable: false,
    };
  }

  return {
    name: "global-hooks-path",
    status: "warn",
    message: `global core.hooksPath set to ${hooksPath}; prefer repo-local hooks for worktree safety`,
    fixable: true,
  };
}

export function buildIdentityProfileCheck(input: {
  expectedProfile?: { name: string; userName: string; userEmail: string };
  identity: GitIdentity;
}): HookHealthCheck {
  if (!input.expectedProfile) {
    return {
      name: "identity-profile",
      status: "ok",
      message: "no identity profile matched this repository",
      fixable: false,
    };
  }
  if (profileMatchesGitIdentity(input.expectedProfile, input.identity)) {
    return {
      name: "identity-profile",
      status: "ok",
      message: `identity matches ${input.expectedProfile.name}`,
      fixable: false,
    };
  }
  return {
    name: "identity-profile",
    status: "warn",
    message: `expected ${input.expectedProfile.name} (${input.expectedProfile.userName} <${input.expectedProfile.userEmail}>)`,
    fixable: true,
  };
}

const TOOLS_DIR = toolsDir();

// ── Hook Installation ────────────────────────────────────────────────

async function resolveGitPath(projectDir: string, path: string): Promise<string | null> {
  const result = await $`git rev-parse --git-path ${path}`.cwd(projectDir).nothrow().quiet();
  if (result.exitCode !== 0) return null;
  const resolved = result.stdout.toString().trim();
  if (!resolved) return null;
  return resolved.startsWith("/") ? resolved : join(projectDir, resolved);
}

async function installHooks(projectDir: string): Promise<number> {
  const gitPath = Bun.which("git");
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

  const hookContent: Record<GitHookName, string> = {
    "pre-commit": renderPreCommitHook(),
    "pre-push": renderPrePushHook(TOOLS_DIR),
  };

  for (const hook of GIT_HOOK_NAMES) {
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
  logger.info("  pre-commit: policy checks + run-gates (format, lint, typecheck, test:changed)");
  logger.info(
    "  pre-push:   no-op skip, run-gates (guardian, portal:gate, R-Score, check:fast:skip-tests, test:changed:push, sync)"
  );
  logger.info("              Set KIMI_PRE_PUSH_FULL=1 to run the full local gate before push.");
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
  if (!pathExists(hooksDir)) {
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
  if (!pathExists(preCommitPath)) {
    checks.push({
      name: "pre-commit",
      status: "warn",
      message: "pre-commit hook not installed",
      fixable: true,
    });
  } else {
    const content = await Bun.file(preCommitPath).text();
    const analysis = analyzePreCommitHook(content);
    const missing = describeMissingHookMarkers(analysis);
    checks.push({
      name: "pre-commit",
      status: analysis.ok ? "ok" : "warn",
      message: analysis.managed
        ? analysis.ok
          ? "Installed with run-gates pre-commit delegate"
          : `Installed but stale template — missing ${missing}; run kimi-githooks fix`
        : "Custom pre-commit (not managed)",
      fixable: !analysis.ok,
    });
  }

  // Check pre-push
  const prePushPath = join(hooksDir, "pre-push");
  if (!pathExists(prePushPath)) {
    checks.push({
      name: "pre-push",
      status: "warn",
      message: "pre-push hook not installed",
      fixable: true,
    });
  } else {
    const content = await Bun.file(prePushPath).text();
    const analysis = analyzePrePushHook(content);
    const missing = describeMissingHookMarkers(analysis);
    checks.push({
      name: "pre-push",
      status: analysis.ok ? "ok" : "warn",
      message: analysis.managed
        ? analysis.ok
          ? "Installed with ref skip guards + run-gates pre-push delegate"
          : `Installed but stale template — missing ${missing}; run kimi-githooks fix`
        : "Custom pre-push (not managed)",
      fixable: !analysis.ok,
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
    if (pathExists(repoGov) && pathExists(desktopGov)) {
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
  if (command === "run-gates") {
    const hook = args[1];
    const dryRun = args.includes("--dry-run") || args.includes("--dryrun");
    if (hook === "pre-commit") {
      if (dryRun) return runPreCommitDryRun(projectDir);
      const policyCode = await runPreCommitPolicy(projectDir);
      if (policyCode !== 0) return policyCode;
      return runPreCommitGates(projectDir);
    }
    if (hook === "pre-push") {
      if (dryRun) return runPrePushDryRun(projectDir);
      return runPrePushGates(projectDir);
    }
    logger.error("Usage: run-gates <pre-commit|pre-push> [--dry-run]");
    return 1;
  }
  if (command === "pre-commit") {
    return runPreCommitGates(projectDir);
  }
  if (command === "pre-push") {
    return runPrePushGates(projectDir);
  }

  logger.section("Commands");
  logger.info("  install        Install pre-commit and pre-push hooks");
  logger.info("  doctor         Check hook installation health");
  logger.info("  fix            Re-install missing/outdated hooks");
  logger.info("  run-gates      Hook gate runner (pre-commit | pre-push) [--dry-run]");
  logger.info("  pre-commit     Run pre-commit gates manually");
  logger.info("  pre-push       Run pre-push gates manually");
  return 0;
}

if (isDirectRun(import.meta.path)) {
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
