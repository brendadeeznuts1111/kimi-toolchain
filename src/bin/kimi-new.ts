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
import { createLogger } from "../lib/logger.ts";

const logger = createLogger(Bun.argv, "kimi-new");
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
      logger.error("--path requires a directory");
      process.exit(1);
    }
    parent = resolve(pathArg);
  }
  return parent;
}

async function runDoctor(parent: string): Promise<number> {
  logger.section("kimi-new doctor");
  let errors = 0;

  const bunPath = Bun.which("bun");
  if (bunPath) {
    logger.check({
      name: "bun",
      status: "ok",
      message: `${Bun.version} (${bunPath})`,
      fixable: false,
    });
  } else {
    logger.check({ name: "bun", status: "error", message: "not on PATH", fixable: false });
    errors++;
  }

  if (existsSync(parent)) {
    logger.check({ name: "parent path", status: "ok", message: parent, fixable: false });
  } else {
    logger.check({
      name: "parent path",
      status: "error",
      message: `missing: ${parent}`,
      fixable: false,
    });
    errors++;
  }

  const desktopFix = join(toolsDir(), "kimi-fix.ts");
  const repoFix = join(import.meta.dir, "kimi-fix.ts");
  if (existsSync(desktopFix)) {
    logger.check({ name: "kimi-fix", status: "ok", message: desktopFix, fixable: false });
  } else if (existsSync(repoFix)) {
    logger.check({
      name: "kimi-fix",
      status: "ok",
      message: `${repoFix} (repo source)`,
      fixable: false,
    });
  } else {
    logger.check({
      name: "kimi-fix",
      status: "error",
      message: "not found — run bun run sync",
      fixable: false,
    });
    errors++;
  }

  const sample = "my-app";
  if (NAME_RE.test(sample)) {
    logger.check({
      name: "name validation",
      status: "ok",
      message: `accepts '${sample}'`,
      fixable: false,
    });
  } else {
    logger.check({
      name: "name validation",
      status: "error",
      message: "regex broken",
      fixable: false,
    });
    errors++;
  }

  if (errors > 0) {
    logger.error(`${errors} issue(s) — fix before running kimi-new`);
    return 1;
  }
  logger.info("Ready to scaffold — kimi-new <name> [--path <dir>]");
  return 0;
}

async function runScaffold(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter((a) => a !== "--dry-run");

  const name = filtered[0];
  if (!NAME_RE.test(name)) {
    logger.error(`Invalid project name: ${name}`);
    process.exit(1);
  }

  const parent = resolveParent(filtered);
  const projectDir = join(parent, name);

  if (existsSync(projectDir)) {
    logger.error(`Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  logger.section(`Creating ${name}`);
  logger.info(`Path: ${projectDir}`);

  if (dryRun) {
    console.log(`  [dry-run] mkdir ${projectDir}`);
    console.log(`  [dry-run] bun init -y (cwd=${projectDir})`);
    console.log(`  [dry-run] kimi-fix ${projectDir}`);
    logger.info("Dry run complete. Remove --dry-run to create.");
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
    logger.warn(`kimi-fix exited ${exitCode} — review output above`);
  }

  logger.section("Next Steps");
  console.log(`  cd ${projectDir}`);
  console.log("  bun run check:fast");
  console.log("  kimi login");
  console.log("  kimi-doctor --quick");
  logger.info(`Project ${name} scaffolded.`);
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
  logger.error(`kimi-new failed: ${err.message}`);
  process.exit(1);
});
