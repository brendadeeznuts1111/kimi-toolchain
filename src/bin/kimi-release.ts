#!/usr/bin/env bun
/**
 * kimi-release — Conventional commit parser + changelog auto-generator + semver validator
 *
 * Usage:
 *   kimi-release [changelog|semver|validate|doctor|fix]
 */

import { existsSync } from "fs";
import { join } from "path";
import { getProjectName, resolveProjectRoot } from "../lib/utils.ts";
import { runTool } from "../lib/tool-runner.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  getCommits,
  getLastTag,
  determineBump,
  bumpVersion,
  validateCommits,
} from "../lib/conventional-commits.ts";
import { commitsToSection, formatSection, updateChangelog } from "../lib/changelog.ts";

const logger = createLogger(Bun.argv, "kimi-release");

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(
  projectDir: string
): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  // Git repo
  const hasGit = existsSync(join(projectDir, ".git"));
  checks.push({
    name: "git-repo",
    status: hasGit ? "ok" : "error",
    message: hasGit ? "Git repository" : "Not a git repository",
    fixable: false,
  });

  // Conventional commit ratio
  const { valid, invalid } = await validateCommits(projectDir);
  const total = valid.length + invalid.length;
  const ratio = total > 0 ? valid.length / total : 0;
  checks.push({
    name: "conventional-commits",
    status: ratio >= 0.8 ? "ok" : ratio >= 0.5 ? "warn" : "error",
    message: `${valid.length}/${total} conventional (${(ratio * 100).toFixed(0)}%)`,
    fixable: invalid.length > 0,
  });

  // CHANGELOG.md
  const changelogPath = join(projectDir, "CHANGELOG.md");
  checks.push({
    name: "CHANGELOG.md",
    status: existsSync(changelogPath) ? "ok" : "warn",
    message: existsSync(changelogPath) ? "present" : "missing",
    fixable: !existsSync(changelogPath),
  });

  // Tag consistency
  const lastTag = await getLastTag();
  checks.push({
    name: "tags",
    status: lastTag ? "ok" : "warn",
    message: lastTag ? `Last: ${lastTag}` : "No tags found",
    fixable: false,
  });

  // R-Score gate
  try {
    const govResult = await runTool("kimi-governance", ["score"], {
      cwd: projectDir,
      timeoutMs: 30000,
    });
    const gradeMatch = govResult.stdout.match(/Grade:\s*([A-F])/);
    const grade = gradeMatch ? gradeMatch[1] : "?";
    checks.push({
      name: "r-score",
      status: grade === "A" || grade === "B" ? "ok" : grade === "C" ? "warn" : "error",
      message: `Grade: ${grade}`,
      fixable: grade === "F" || grade === "D",
    });
  } catch {
    checks.push({
      name: "r-score",
      status: "warn",
      message: "Could not check R-Score",
      fixable: false,
    });
  }

  return checks;
}

// ── Fix ──────────────────────────────────────────────────────────────

async function fixCommits(projectDir: string) {
  logger.section("Fixing Non-Conventional Commits");
  const { invalid } = await validateCommits(projectDir);
  if (invalid.length === 0) {
    logger.info("All recent commits follow conventional format");
    return;
  }

  logger.warn(`${invalid.length} non-conventional commit(s) found:`);
  for (const msg of invalid.slice(0, 5)) {
    logger.line(`    ✗ ${msg.slice(0, 80)}`);
  }
  logger.info('To fix the most recent commit: git commit --amend -m "feat(scope): description"');
  logger.info("For older commits, use interactive rebase: git rebase -i HEAD~20");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "changelog";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = await getProjectName(projectDir);

  logger.banner("Kimi Release — Conventional Commits", project);

  if (command === "changelog") {
    const sinceTag = await getLastTag();
    logger.section("Changelog Generation");
    if (sinceTag) logger.info(`Since tag: ${sinceTag}`);
    else logger.info("No tags found — scanning last 50 commits");

    const commits = await getCommits(sinceTag);
    if (commits.length === 0) {
      logger.warn("No conventional commits found since last tag.");
      logger.info("Expected format: feat(scope): description");
      logger.info("                 fix(scope): description");
      logger.info("                 feat!: breaking change");
      return 0;
    }

    logger.info(`Found ${commits.length} conventional commits`);

    const bump = determineBump(commits);
    logger.info(`Semver bump: ${bump}`);

    const pkgPath = join(projectDir, "package.json");
    let currentVersion = "0.0.0";
    if (existsSync(pkgPath)) {
      const pkg = (await Bun.file(pkgPath).json()) as any;
      currentVersion = pkg.version || "0.0.0";
    }

    const newVersion = bump === "none" ? currentVersion : bumpVersion(currentVersion, bump);
    logger.info(`Version: ${currentVersion} → ${newVersion}`);

    const section = commitsToSection(commits, newVersion);
    const formatted = formatSection(section);

    logger.section("Generated Section");
    logger.line(formatted);

    const dryRun = args.includes("--dry-run");
    if (!dryRun) {
      await updateChangelog(projectDir, formatted, newVersion);
      logger.info("CHANGELOG.md updated");
    } else {
      logger.info("[dry-run] No files modified");
    }
  } else if (command === "semver") {
    logger.section("Semver Analysis");
    const sinceTag = await getLastTag();
    const commits = await getCommits(sinceTag);
    const bump = determineBump(commits);

    logger.info(`Commits since ${sinceTag || "last 50"}: ${commits.length}`);
    logger.info(`Breaking: ${commits.filter((c) => c.breaking).length}`);
    logger.info(`Features: ${commits.filter((c) => c.type === "feat").length}`);
    logger.info(`Fixes:    ${commits.filter((c) => c.type === "fix").length}`);
    logger.info(`Bump:     ${bump}`);
  } else if (command === "validate") {
    logger.section("Commit Validation");
    const { valid, invalid } = await validateCommits(projectDir);

    logger.info(`Valid conventional commits: ${valid.length}`);
    logger.info(`Invalid commits: ${invalid.length}`);

    if (invalid.length > 0) {
      logger.warn("Non-conventional commits (should follow 'type(scope): msg'):");
      for (const msg of invalid.slice(0, 10)) {
        logger.line(`    ✗ ${msg.slice(0, 80)}`);
      }
    }

    const types = new Map<string, number>();
    for (const c of valid) {
      types.set(c.type, (types.get(c.type) || 0) + 1);
    }
    logger.info("Commit types:");
    for (const [type, count] of types.entries()) {
      logger.line(`    ${type}: ${count}`);
    }
  } else if (command === "doctor") {
    const checks = await doctor(projectDir);
    return logger.runDoctor("kimi-release", checks);
  } else if (command === "fix") {
    await fixCommits(projectDir);
  } else {
    logger.section("Commands");
    logger.line("  changelog [--dry-run]  Generate CHANGELOG.md section from conventional commits");
    logger.line("  semver                 Analyze semver bump needed");
    logger.line("  validate               Validate recent commits follow conventional format");
    logger.line("  doctor                 Check release readiness");
    logger.line("  fix                    Fix non-conventional commits");
  }

  return 0;
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      new CliError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }),
  { toolName: "kimi-release", logger }
);
process.exit(exitCode);
