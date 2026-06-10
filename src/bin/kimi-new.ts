#!/usr/bin/env bun
/**
 * kimi-new — Greenfield project scaffold
 * Usage: kimi-new <name> [--path <dir>] [--dry-run]
 *        kimi-new doctor [--path <parent-dir>]
 */

import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { $ } from "bun";
import { toolsDir } from "../lib/utils.ts";

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function printHelp() {
  console.log("Usage: kimi-new <name> [--path <parent-dir>] [--dry-run]");
  console.log("       kimi-new doctor [--path <parent-dir>]");
  console.log("");
  console.log("Creates a new Bun project and runs kimi-fix:");
  console.log("  mkdir <name> && bun init -y && kimi-fix .");
}

function resolveParent(args: string[]): string {
  let parent = Bun.cwd;
  const pathIdx = args.indexOf("--path");
  if (pathIdx !== -1) {
    const pathArg = args[pathIdx + 1];
    if (!pathArg) {
      console.log("✗ --path requires a directory");
      process.exit(1);
    }
    parent = resolve(pathArg);
  }
  return parent;
}

async function runDoctor(parent: string): Promise<number> {
  console.log("── kimi-new doctor ──────────────────────────────────────────");
  let errors = 0;

  const bunPath = Bun.which("bun");
  if (bunPath) {
    console.log(`  ✓ bun: ${Bun.version} (${bunPath})`);
  } else {
    console.log("  ✗ bun: not on PATH");
    errors++;
  }

  if (existsSync(parent)) {
    console.log(`  ✓ parent path: ${parent}`);
  } else {
    console.log(`  ✗ parent path missing: ${parent}`);
    errors++;
  }

  const desktopFix = join(toolsDir(), "kimi-fix.ts");
  const repoFix = join(import.meta.dir, "kimi-fix.ts");
  if (existsSync(desktopFix)) {
    console.log(`  ✓ kimi-fix: ${desktopFix}`);
  } else if (existsSync(repoFix)) {
    console.log(`  ✓ kimi-fix: ${repoFix} (repo source)`);
  } else {
    console.log("  ✗ kimi-fix not found — run bun run sync");
    errors++;
  }

  const sample = "my-app";
  if (NAME_RE.test(sample)) {
    console.log(`  ✓ name validation: accepts '${sample}'`);
  } else {
    console.log("  ✗ name validation regex broken");
    errors++;
  }

  console.log("");
  if (errors > 0) {
    console.log(`  ✗ ${errors} issue(s) — fix before running kimi-new`);
    return 1;
  }
  console.log("  ✓ Ready to scaffold — kimi-new <name> [--path <dir>]");
  return 0;
}

async function runScaffold(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter((a) => a !== "--dry-run");

  const name = filtered[0];
  if (!NAME_RE.test(name)) {
    console.log(`✗ Invalid project name: ${name}`);
    process.exit(1);
  }

  const parent = resolveParent(filtered);
  const projectDir = join(parent, name);

  if (existsSync(projectDir)) {
    console.log(`✗ Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  console.log(`=== Creating ${name} ===`);
  console.log(`  Path: ${projectDir}`);
  console.log("");

  if (dryRun) {
    console.log(`  [dry-run] mkdir ${projectDir}`);
    console.log(`  [dry-run] bun init -y (cwd=${projectDir})`);
    console.log(`  [dry-run] kimi-fix ${projectDir}`);
    console.log("");
    console.log("✓ Dry run complete. Remove --dry-run to create.");
    return;
  }

  mkdirSync(projectDir, { recursive: true });
  await $`bun init -y`.cwd(projectDir).quiet();

  const desktopFix = join(toolsDir(), "kimi-fix.ts");
  const fixScript = existsSync(desktopFix) ? desktopFix : join(import.meta.dir, "kimi-fix.ts");
  const proc = Bun.spawn(["bun", "run", fixScript, projectDir], {
    cwd: parent,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);

  for (const line of (stdout + stderr).split("\n")) {
    if (line.trim()) console.log(line);
  }

  if (exitCode !== 0) {
    console.log(`⚠ kimi-fix exited ${exitCode} — review output above`);
  }

  console.log("");
  console.log("── Next Steps ────────────────────────────────────────────────");
  console.log(`  cd ${projectDir}`);
  console.log("  bun run check:fast");
  console.log("  kimi login");
  console.log("  kimi-doctor --quick");
  console.log("");
  console.log(`✓ Project ${name} scaffolded.`);
}

async function main() {
  const args = Bun.argv.slice(2);
  const filtered = args.filter((a) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    process.exit(filtered.length === 0 ? 1 : 0);
  }

  if (filtered[0] === "doctor") {
    const parent = resolveParent(filtered.slice(1));
    process.exit(await runDoctor(parent));
  }

  await runScaffold(args);
}

main().catch((err) => {
  console.error("kimi-new failed:", err.message);
  process.exit(1);
});
