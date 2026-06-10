#!/usr/bin/env bun
/**
 * kimi-new — Greenfield project scaffold
 * Usage: kimi-new <name> [--path <dir>] [--dry-run]
 */

import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { $ } from "bun";
import { toolsDir } from "../lib/utils.ts";

function printHelp() {
  console.log("Usage: kimi-new <name> [--path <parent-dir>] [--dry-run]");
  console.log("");
  console.log("Creates a new Bun project and runs kimi-fix:");
  console.log("  mkdir <name> && bun init -y && kimi-fix .");
}

async function main() {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter((a) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    process.exit(filtered.length === 0 ? 1 : 0);
  }

  const name = filtered[0];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    console.log(`✗ Invalid project name: ${name}`);
    process.exit(1);
  }

  let parent = Bun.cwd;
  const pathIdx = filtered.indexOf("--path");
  if (pathIdx !== -1) {
    const pathArg = filtered[pathIdx + 1];
    if (!pathArg) {
      console.log("✗ --path requires a directory");
      process.exit(1);
    }
    parent = resolve(pathArg);
  }

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

main().catch((err) => {
  console.error("kimi-new failed:", err.message);
  process.exit(1);
});
