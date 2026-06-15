#!/usr/bin/env bun
/**
 * kimi-release — Conventional commit parser + changelog auto-generator + semver validator
 *
 * Usage:
 *   kimi-release [changelog|semver|validate|doctor|fix]
 */

import { existsSync } from "fs";
import { join } from "path";
import {
  log,
  getProjectName,
  runTool,
  resolveProjectRoot,
  printProjectBanner,
  buildDoctorReport,
  printDoctorReport,
} from "../lib/utils.ts";
import {
  getCommits,
  getLastTag,
  determineBump,
  bumpVersion,
  validateCommits,
} from "../lib/conventional-commits.ts";
import { commitsToSection, formatSection, updateChangelog } from "../lib/changelog.ts";

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
  console.log("── Fixing Non-Conventional Commits ───────────────────────────");
  const { invalid } = await validateCommits(projectDir);
  if (invalid.length === 0) {
    log("info", "All recent commits follow conventional format");
    return;
  }

  console.log(`  ${invalid.length} non-conventional commit(s) found:`);
  for (const msg of invalid.slice(0, 5)) {
    console.log(`    ✗ ${msg.slice(0, 80)}`);
  }
  console.log("  To fix the most recent commit:");
  console.log('    git commit --amend -m "feat(scope): description"');
  console.log("  For older commits, use interactive rebase:");
  console.log("    git rebase -i HEAD~20");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "changelog";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const project = await getProjectName(projectDir);

  printProjectBanner("Kimi Release — Conventional Commits", project);

  if (command === "changelog") {
    const sinceTag = await getLastTag();
    console.log(`── Changelog Generation ──────────────────────────────────────`);
    if (sinceTag) console.log(`  Since tag: ${sinceTag}`);
    else console.log(`  No tags found — scanning last 50 commits`);

    const commits = await getCommits(sinceTag);
    if (commits.length === 0) {
      console.log("  No conventional commits found since last tag.");
      console.log("  Expected format: feat(scope): description");
      console.log("                   fix(scope): description");
      console.log("                   feat!: breaking change");
      return;
    }

    console.log(`  Found ${commits.length} conventional commits`);

    const bump = determineBump(commits);
    console.log(`  Semver bump: ${bump}`);

    const pkgPath = join(projectDir, "package.json");
    let currentVersion = "0.0.0";
    if (existsSync(pkgPath)) {
      const pkg = (await Bun.file(pkgPath).json()) as any;
      currentVersion = pkg.version || "0.0.0";
    }

    const newVersion = bump === "none" ? currentVersion : bumpVersion(currentVersion, bump);
    console.log(`  Version: ${currentVersion} → ${newVersion}`);

    const section = commitsToSection(commits, newVersion);
    const formatted = formatSection(section);

    console.log("── Generated Section ─────────────────────────────────────────");
    console.log(formatted);

    const dryRun = args.includes("--dry-run");
    if (!dryRun) {
      await updateChangelog(projectDir, formatted, newVersion);
      console.log("  ✓ CHANGELOG.md updated");
    } else {
      console.log("  [dry-run] No files modified");
    }
  } else if (command === "semver") {
    console.log(`── Semver Analysis ───────────────────────────────────────────`);
    const sinceTag = await getLastTag();
    const commits = await getCommits(sinceTag);
    const bump = determineBump(commits);

    console.log(`  Commits since ${sinceTag || "last 50"}: ${commits.length}`);
    console.log(`  Breaking: ${commits.filter((c) => c.breaking).length}`);
    console.log(`  Features: ${commits.filter((c) => c.type === "feat").length}`);
    console.log(`  Fixes:    ${commits.filter((c) => c.type === "fix").length}`);
    console.log(`  Bump:     ${bump}`);
  } else if (command === "validate") {
    console.log(`── Commit Validation ─────────────────────────────────────────`);
    const { valid, invalid } = await validateCommits(projectDir);

    console.log(`  Valid conventional commits: ${valid.length}`);
    console.log(`  Invalid commits: ${invalid.length}`);

    if (invalid.length > 0) {
      console.log("  Non-conventional commits (should follow 'type(scope): msg'):");
      for (const msg of invalid.slice(0, 10)) {
        console.log(`    ✗ ${msg.slice(0, 80)}`);
      }
    }

    const types = new Map<string, number>();
    for (const c of valid) {
      types.set(c.type, (types.get(c.type) || 0) + 1);
    }
    console.log("  Commit types:");
    for (const [type, count] of types.entries()) {
      console.log(`    ${type}: ${count}`);
    }
  } else if (command === "doctor") {
    const checks = await doctor(projectDir);
    const report = buildDoctorReport("kimi-release", checks);
    printDoctorReport(report);
    if (report.fixableCount > 0) {
      console.log("  Run 'kimi-release fix' to repair");
    }
  } else if (command === "fix") {
    await fixCommits(projectDir);
  } else {
    console.log("Commands:");
    console.log("  changelog [--dry-run]  Generate CHANGELOG.md section from conventional commits");
    console.log("  semver                 Analyze semver bump needed");
    console.log("  validate               Validate recent commits follow conventional format");
    console.log("  doctor                 Check release readiness");
    console.log("  fix                    Fix non-conventional commits");
  }
}

main().catch((err) => {
  console.error("kimi-release failed:", err.message);
  process.exit(1);
});
