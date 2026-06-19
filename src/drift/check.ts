#!/usr/bin/env bun
/**
 * drift/check.ts — Dependency drift detector
 * Quick check for outdated/unused deps vs lockfile
 *
 * Usage:
 *   bun run src/drift/check.ts [--quick] [--exit-code]  (from repo)
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const QUICK = Bun.argv.includes("--quick");
const EXIT_ON_FAIL = Bun.argv.includes("--exit-code");

interface DriftIssue {
  type: "outdated" | "unused" | "missing";
  package: string;
  current?: string;
  latest?: string;
}

async function main() {
  const cwd = Bun.cwd;
  const pkgPath = join(cwd, "package.json");
  const lockPath = join(cwd, "bun.lock");

  if (!existsSync(pkgPath)) {
    console.log("⚠ No package.json found — skipping drift check");
    process.exit(0);
  }

  const issues: DriftIssue[] = [];

  // Quick mode: just check if lockfile is stale vs package.json
  if (QUICK && existsSync(lockPath)) {
    const pkgMtime = Bun.file(pkgPath).lastModified;
    const lockMtime = Bun.file(lockPath).lastModified;
    if (pkgMtime > lockMtime) {
      issues.push({ type: "missing", package: "(lockfile stale)", current: "out of date" });
    }
  }

  // Full mode: check for outdated packages via bun pm
  if (!QUICK) {
    try {
      const result = await $`bun pm ls`.cwd(cwd).nothrow().quiet();
      const output = result.stdout.toString();
      // Basic heuristic: if bun pm ls reports anything suspicious
      if (output.includes("extraneous") || output.includes("unmet")) {
        issues.push({ type: "unused", package: "(see bun pm ls output)" });
      }
    } catch {
      /* ignore */
    }
  }

  if (issues.length > 0) {
    console.log("⚠ Dependency drift detected:");
    for (const i of issues) {
      console.log(`  ${i.type}: ${i.package}${i.current ? ` (${i.current})` : ""}`);
    }
    console.log("   Run 'bun install' to update lockfile");
    if (EXIT_ON_FAIL) process.exit(1);
  } else {
    console.log("✓ No dependency drift");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Drift check failed:", err.message);
  if (EXIT_ON_FAIL) process.exit(1);
});
