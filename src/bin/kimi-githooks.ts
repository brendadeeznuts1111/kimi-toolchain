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
import {
  runPreCommitDryRun,
  runPreCommitGates,
  runPreCommitPolicy,
  runPrePushDryRun,
  runPrePushGates,
} from "../lib/hook-gates.ts";
import { TOOLCHAIN_VERSION } from "../lib/version.ts";
import {
  detectIdentityProfile,
  loadIdentityMatrix,
  profileMatchesGitIdentity,
  type GitIdentity,
} from "../lib/identity-matrix.ts";

const logger = createLogger(Bun.argv, "kimi-githooks");

const HOOKS = ["pre-commit", "pre-push"] as const;
const TOOLS_DIR = toolsDir();

interface HookCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export function buildGlobalHooksPathCheck(globalHooksPath: string | null | undefined): HookCheck {
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

async function gitOutput(projectDir: string, args: string[]): Promise<string | undefined> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    Bun.readableStreamToText(proc.stdout),
  ]);
  await Bun.readableStreamToText(proc.stderr);
  const text = stdout.trim();
  return exitCode === 0 && text ? text : undefined;
}

export function buildIdentityProfileCheck(input: {
  expectedProfile?: { name: string; userName: string; userEmail: string };
  identity: GitIdentity;
}): HookCheck {
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

async function resolveHooksDir(projectDir: string): Promise<string> {
  const result = await $`git rev-parse --git-path hooks`.cwd(projectDir).nothrow().quiet();
  const resolved = result.stdout.toString().trim();
  return result.exitCode === 0 && resolved ? resolved : join(projectDir, ".git", "hooks");
}

const HOOK_GITHOOKS_RESOLVER = `
GITHOOKS=""
if [ -f "src/bin/kimi-githooks.ts" ]; then
  GITHOOKS="bun src/bin/kimi-githooks.ts"
elif [ -f "${TOOLS_DIR}/kimi-githooks.ts" ]; then
  GITHOOKS="bun ${TOOLS_DIR}/kimi-githooks.ts"
elif command -v kimi-githooks >/dev/null 2>&1; then
  GITHOOKS="kimi-githooks"
fi

if [ -z "$GITHOOKS" ]; then
  echo "✗ kimi-githooks not found"
  echo "  Checked: src/bin/kimi-githooks.ts"
  echo "           ${TOOLS_DIR}/kimi-githooks.ts"
  echo "           PATH (kimi-githooks)"
  echo "  Fix: kimi-githooks install"
  echo "       bun run sync && kimi-githooks fix"
  exit 1
fi
`;

const PRE_COMMIT_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P0: Block secrets; P1: quality gates (quiet when KIMI_QUIET=1 or KIMI_AGENT_SESSION)

if [ -n "$KIMI_AGENT_SESSION" ]; then export KIMI_QUIET=1; fi
${HOOK_GITHOOKS_RESOLVER}
$GITHOOKS run-gates pre-commit || exit 1
exit 0
`;

const PRE_PUSH_HOOK = `#!/bin/sh
# Auto-installed by kimi-githooks
# P1: guardian, constant-drift, R-Score, check:fast, effect-gates
#     (KIMI_PRE_PUSH_FULL=1 for full check; KIMI_SKIP_EFFECT_GATES=1 to skip)

if [ -n "$KIMI_AGENT_SESSION" ]; then export KIMI_QUIET=1; fi
${HOOK_GITHOOKS_RESOLVER}
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
  logger.info(
    "  pre-push:   guardian, constant-drift, R-Score, check:fast, effect-gates (KIMI_PRE_PUSH_FULL=1 for full), sync"
  );

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
  const checks: HookCheck[] = [];

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
    const hasQuality =
      content.includes("run-gates pre-commit") ||
      (content.includes("format:check") && content.includes("typecheck"));
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
    const hasQuality = content.includes("check:fast") || content.includes("Quality Gate");
    const delegatesToRunner = content.includes("run-gates pre-push");
    const hasEffectGates = content.includes("effect-gates");
    const prePushOk = hasKimi && hasQuality && delegatesToRunner && hasEffectGates;
    checks.push({
      name: "pre-push",
      status: prePushOk ? "ok" : hasKimi ? "warn" : "warn",
      message: hasKimi
        ? prePushOk
          ? "Installed with repo-first tools, quality gate, effect-gates, mandatory desktop sync"
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

  const globalHooksPath = await $`git config --global --get core.hooksPath`.nothrow().quiet();
  checks.push(
    buildGlobalHooksPathCheck(
      globalHooksPath.exitCode === 0 ? globalHooksPath.stdout.toString() : null
    )
  );

  const [matrix, remoteUrl, userName, userEmail] = await Promise.all([
    loadIdentityMatrix({ projectRoot: projectDir }),
    gitOutput(projectDir, ["remote", "get-url", "origin"]),
    gitOutput(projectDir, ["config", "--get", "user.name"]),
    gitOutput(projectDir, ["config", "--get", "user.email"]),
  ]);
  const detection = detectIdentityProfile({ matrix, repoPath: projectDir, remoteUrl });
  checks.push(
    buildIdentityProfileCheck({
      expectedProfile: detection.profile,
      identity: { userName, userEmail },
    })
  );

  return checks;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  if (args.includes("--version") || args.includes("-V")) {
    Bun.stdout.write(`kimi-githooks ${TOOLCHAIN_VERSION}\n`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const cmdArgs = args.filter((arg) => arg !== "--dry-run");
  const command = cmdArgs[0] || "install";
  const projectDir = await resolveProjectRoot(Bun.cwd);

  if (!dryRun) logger.banner("Kimi Git Hooks");

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
    if (dryRun) return runPreCommitDryRun(projectDir);
    logger.section("Pre-commit checks");
    const policy = await runPreCommitPolicy(projectDir);
    if (policy !== 0) return policy;
    return runPreCommitGates(projectDir);
  }
  if (command === "run-gates") {
    ensureQuietEnv();
    const hook = cmdArgs[1];
    if (hook === "pre-commit") {
      if (dryRun) return runPreCommitDryRun(projectDir);
      const policy = await runPreCommitPolicy(projectDir);
      if (policy !== 0) return policy;
      return runPreCommitGates(projectDir);
    }
    if (hook === "pre-push") {
      if (dryRun) return runPrePushDryRun(projectDir);
      return runPrePushGates(projectDir);
    }
    logger.error("Usage: run-gates <pre-commit|pre-push> [--dry-run]");
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
  logger.info("  pre-commit     Run pre-commit gates manually [--dry-run]");
  logger.info("  pre-push       Info about pre-push checks");
  logger.info("  run-gates      Hook gate runner (pre-commit | pre-push) [--dry-run]");
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
