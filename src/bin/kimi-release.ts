#!/usr/bin/env bun
/**
 * kimi-release — Conventional commit parser + changelog auto-generator + semver validator
 *
 * Usage:
 *   kimi-release [changelog|semver|validate|doctor|fix]
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import {
  log,
  getProjectName,
  runTool,
  resolveProjectRoot,
  printProjectBanner,
} from "../lib/utils.ts";

interface Commit {
  hash: string;
  subject: string;
  body: string;
  type: string;
  scope: string;
  breaking: boolean;
}

interface ChangelogSection {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  deprecated: string[];
  removed: string[];
  security: string[];
  breaking: string[];
}

// ── Conventional Commit Parser ───────────────────────────────────────

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

function parseCommit(hash: string, subject: string, body: string): Commit | null {
  const match = CONVENTIONAL_RE.exec(subject);
  if (!match) return null;

  const [, type, scope, _msg] = match;
  const breaking = subject.endsWith("!") || body.includes("BREAKING CHANGE:");

  return { hash, subject, body, type: type.toLowerCase(), scope, breaking };
}

async function getCommits(sinceTag?: string): Promise<Commit[]> {
  const range = sinceTag ? `${sinceTag}..HEAD` : undefined;
  const result = range
    ? await $`git log ${range} --format=%H%x00%s%x00%b%x00`.nothrow().quiet()
    : await $`git log --format=%H%x00%s%x00%b%x00`.nothrow().quiet();
  if (result.exitCode !== 0) return [];

  const raw = result.stdout.toString();
  const parts = raw.split("\x00");
  const commits: Commit[] = [];

  for (let i = 0; i < parts.length; i += 3) {
    const hash = parts[i]?.trim() || "";
    const subject = parts[i + 1]?.trim() || "";
    const body = parts[i + 2]?.trim() || "";
    if (!hash && !subject) continue;
    const parsed = parseCommit(hash, subject, body);
    if (parsed) commits.push(parsed);
  }

  return commits;
}

async function getLastTag(): Promise<string | undefined> {
  try {
    const result = await $`git describe --tags --abbrev=0`.nothrow().quiet();
    return result.stdout?.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Semver Analysis ──────────────────────────────────────────────────

function determineBump(commits: Commit[]): "major" | "minor" | "patch" | "none" {
  let hasBreaking = false;
  let hasFeature = false;
  let hasFix = false;

  for (const c of commits) {
    if (c.breaking) hasBreaking = true;
    else if (c.type === "feat") hasFeature = true;
    else if (c.type === "fix") hasFix = true;
  }

  if (hasBreaking) return "major";
  if (hasFeature) return "minor";
  if (hasFix) return "patch";
  return "none";
}

function bumpVersion(current: string, bump: "major" | "minor" | "patch"): string {
  const [major, minor, patch] = current.replace(/^v/, "").split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ── Changelog Generation ─────────────────────────────────────────────

function commitsToSection(commits: Commit[], version: string): ChangelogSection {
  const section: ChangelogSection = {
    version,
    date: new Date().toISOString().split("T")[0],
    added: [],
    changed: [],
    fixed: [],
    deprecated: [],
    removed: [],
    security: [],
    breaking: [],
  };

  for (const c of commits) {
    const entry = c.scope
      ? `**${c.scope}:** ${c.subject.replace(CONVENTIONAL_RE, "$3")}`
      : c.subject.replace(CONVENTIONAL_RE, "$3");
    const hashLink = ` ([${c.hash.slice(0, 7)}])`;

    if (c.breaking) section.breaking.push(entry + hashLink);
    else if (c.type === "feat") section.added.push(entry + hashLink);
    else if (c.type === "fix") section.fixed.push(entry + hashLink);
    else if (c.type === "docs") section.changed.push(entry + hashLink);
    else if (c.type === "refactor") section.changed.push(entry + hashLink);
    else if (c.type === "perf") section.changed.push(entry + hashLink);
    else if (c.type === "test") section.changed.push(entry + hashLink);
    else if (c.type === "chore") section.changed.push(entry + hashLink);
    else if (c.type === "deps" || c.type === "dependency") section.security.push(entry + hashLink);
  }

  return section;
}

function formatSection(section: ChangelogSection): string {
  const lines: string[] = [`## [${section.version}] - ${section.date}`, ""];

  const pushCategory = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`### ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };

  if (section.breaking.length > 0) {
    lines.push("### ⚠ BREAKING CHANGES", "");
    for (const item of section.breaking) lines.push(`- ${item}`);
    lines.push("");
  }

  pushCategory("Added", section.added);
  pushCategory("Changed", section.changed);
  pushCategory("Fixed", section.fixed);
  pushCategory("Deprecated", section.deprecated);
  pushCategory("Removed", section.removed);
  pushCategory("Security", section.security);

  return lines.join("\n");
}

async function updateChangelog(projectDir: string, section: string, _version: string) {
  const changelogPath = join(projectDir, "CHANGELOG.md");

  let content =
    "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
  if (existsSync(changelogPath)) {
    content = await Bun.file(changelogPath).text();
  }

  const unreleasedMatch = content.match(/## \[Unreleased\]/);
  if (unreleasedMatch) {
    const insertAfter = content.indexOf("\n## [", content.indexOf("## [Unreleased]") + 1);
    if (insertAfter > 0) {
      content = content.slice(0, insertAfter) + "\n" + section + "\n" + content.slice(insertAfter);
    } else {
      content = content + "\n" + section;
    }
  } else {
    const firstH2 = content.search(/\n## \[/);
    if (firstH2 > 0) {
      content = content.slice(0, firstH2 + 1) + section + "\n" + content.slice(firstH2 + 1);
    } else {
      content = content + "\n" + section;
    }
  }

  await Bun.write(changelogPath, content);
}

// ── Validation ───────────────────────────────────────────────────────

async function validateCommits(
  projectDir: string
): Promise<{ valid: Commit[]; invalid: string[] }> {
  const result = await $`git log --format=%H%x00%s%x00%b%x00`.cwd(projectDir).nothrow().quiet();
  const raw = result.stdout.toString();
  const parts = raw.split("\x00");

  const valid: Commit[] = [];
  const invalid: string[] = [];

  for (let i = 0; i < parts.length; i += 3) {
    const hash = parts[i]?.trim() || "";
    const subject = parts[i + 1]?.trim() || "";
    const body = parts[i + 2] ?? "";
    const parsed = parseCommit(hash, subject, body);
    if (parsed) valid.push(parsed);
    else if (subject) invalid.push(subject);
  }

  return { valid, invalid };
}

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
    console.log("── Release Doctor ────────────────────────────────────────────");
    const checks = await doctor(projectDir);
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
    if (fixable > 0) {
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
