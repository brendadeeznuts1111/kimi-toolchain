#!/usr/bin/env bun
/**
 * Unified lint entrypoint — supports both full and scoped (--files) modes.
 *
 * Usage:
 *   bun run lint                  # full lint (all sub-scripts)
 *   bun run lint --files <...>    # scoped lint: oxlint + banned-terms + patterns + test-names + doc-links
 */

import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { filterLintPaths } from "../src/lib/check-changed.ts";
import {
  filterBannedTermPaths,
  filterChangedTestPaths,
  filterDocLinkPaths,
  scopedLintNoticeLine,
} from "../src/lib/check-lint-scoped.ts";
import { formatDocLinkViolation, lintDocLinks } from "../src/lib/doc-links-lint.ts";
import { lintBannedTerms } from "./lint-banned-terms.ts";
import { lintTestNames } from "./lint-test-names.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function parseArgs(): { files: string[] } {
  const args = Bun.argv.slice(2);
  const filesIdx = args.indexOf("--files");
  if (filesIdx === -1) return { files: [] };
  return { files: args.slice(filesIdx + 1).filter((a) => !a.startsWith("-")) };
}

async function runOxlint(paths: string[]): Promise<number> {
  const proc = Bun.spawn(["oxlint", ...paths], {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function runScopedLint(files: string[]): Promise<void> {
  console.log(scopedLintNoticeLine());

  const oxlintPaths = filterLintPaths(files);
  if (oxlintPaths.length > 0) {
    const code = await runOxlint(oxlintPaths);
    if (code !== 0) process.exit(code);
  }

  const bannedPaths = filterBannedTermPaths(files);
  const bannedViolations = await lintBannedTerms(REPO_ROOT, bannedPaths);
  if (bannedViolations.length > 0) {
    console.error("\u2717 Banned terms found:\n");
    for (const v of bannedViolations) console.error(`  ${v}\n`);
    process.exit(1);
  }
  if (bannedPaths.length > 0) console.log("  \u2713 No banned terms");

  const testPaths = filterChangedTestPaths(files);
  const testViolations = await lintTestNames(
    REPO_ROOT,
    testPaths.length > 0 ? testPaths : undefined
  );
  if (testViolations.length > 0) {
    console.error("\u2717 Test naming violations:\n");
    for (const line of testViolations) console.error(`  ${line}`);
    process.exit(1);
  }
  if (testPaths.length > 0) console.log("lint:test-names OK");

  const docLinkPaths = filterDocLinkPaths(files);
  const docViolations = await lintDocLinks(
    REPO_ROOT,
    docLinkPaths.length > 0 ? docLinkPaths : undefined
  );
  if (docViolations.length > 0) {
    console.error("\u2717 Doc link violations found:\n");
    for (const v of docViolations) console.error(`  ${formatDocLinkViolation(v)}\n`);
    process.exit(1);
  }
  if (docLinkPaths.length > 0) console.log("  \u2713 Doc links OK");

  const skillFiles = files.filter((f) => /^skills\/.*\/SKILL\.md$/.test(f));
  if (skillFiles.length > 0) {
    const skillProc = Bun.spawn(["bun", "run", "scripts/lint-skill-frontmatter.ts"], {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await skillProc.exited) !== 0) process.exit(1);
  }

  if (!pathExists(join(REPO_ROOT, ".oxlintrc.json"))) {
    console.warn("  \u26A0 .oxlintrc.json missing");
  }
}

async function runFullLint(): Promise<void> {
  const subScripts = [
    { cmd: ["oxlint", "src", "test", "scripts"], label: "oxlint" },
    { cmd: ["bun", "run", "scripts/lint-banned-terms.ts"], label: "banned-terms" },
    { cmd: ["bun", "run", "scripts/lint-bun-native.ts"], label: "bun-native" },
    { cmd: ["bun", "run", "scripts/lint-context-bloat.ts"], label: "context-bloat" },
    { cmd: ["bun", "run", "scripts/lint-skill-coverage.ts"], label: "skill-coverage" },
    { cmd: ["bun", "run", "scripts/lint-skill-frontmatter.ts"], label: "skill-frontmatter" },
    { cmd: ["bun", "run", "scripts/lint-tochange.ts"], label: "tochange" },
    { cmd: ["bun", "run", "scripts/lint-test-names.ts"], label: "test-names" },
    { cmd: ["bun", "run", "scripts/lint-build-constants.ts"], label: "build-constants" },
    {
      cmd: ["bun", "run", "scripts/generate-constants-manifest.ts", "--check"],
      label: "constants-manifest",
    },
    {
      cmd: ["bun", "run", "scripts/generate-canonical-references.ts", "--check"],
      label: "canonical-references",
    },
    { cmd: ["bun", "run", "scripts/lint-doc-links.ts"], label: "doc-links" },
    { cmd: ["bun", "run", "scripts/lint-constant-parity.ts"], label: "constant-parity" },
    { cmd: ["bun", "run", "scripts/lint-cli-contract.ts"], label: "cli-contract" },
    { cmd: ["bun", "run", "dx:table:contract"], label: "dx:table:contract" },
  ];

  for (const { cmd, label } of subScripts) {
    const proc = Bun.spawn(cmd, {
      cwd: REPO_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      console.error(`\u2717 ${label} failed (exit ${code})`);
      process.exit(code);
    }
  }
}

async function main(): Promise<void> {
  const { files } = parseArgs();

  if (files.length > 0) {
    await runScopedLint(files);
  } else {
    await runFullLint();
  }
}

main().catch((err) => {
  console.error("lint failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
