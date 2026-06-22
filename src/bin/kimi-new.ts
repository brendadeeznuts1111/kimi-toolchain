#!/usr/bin/env bun
/**
 * kimi-new — Greenfield project scaffold
 * Usage: kimi-new <name> [--path <dir>] [--dry-run]
 *        kimi-new doctor [--path <parent-dir>]
 */

import { Effect } from "effect";
import { makeDir, pathExists } from "../lib/bun-io.ts";
import { join, resolve } from "path";
import { $ } from "bun";
import { bunVersion, isDirectRun, readableStreamToText, resolveDevSecrets } from "../lib/bun-utils.ts";
import { toolsDir } from "../lib/paths.ts";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-new");
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function printHelp() {
  logger.info("Usage: kimi-new <name> [--path <parent-dir>] [--dry-run]");
  logger.info("       kimi-new doctor [--path <parent-dir>]");
  logger.info("");
  logger.info("Creates a new Bun project and runs kimi-fix:");
  logger.info("  mkdir <name> && bun init -y && kimi-fix .");
  logger.info("");
  logger.info("Flags:");
  logger.info("  --force       Overwrite existing files");
  logger.info("  --no-install  Skip installing node_modules & tasks");
  logger.info("  --no-git      Don't initialize a git repository");
  logger.info("  --no-secrets  Skip Bun.secrets resolution (use when env already has tokens)");
  logger.info("  --open        Start & open in-browser after finish");
  logger.info("");
  logger.info("Env vars (resolved from Bun.secrets if absent):");
  logger.info("  GITHUB_TOKEN         GitHub auth for private repos / rate limits");
  logger.info("  GITHUB_API_DOMAIN    Custom GitHub enterprise / proxy domain");
  logger.info("  NPM_TOKEN            npm registry auth for bun publish");
}

function resolveParent(args: string[]): string {
  let parent = Bun.cwd;
  const pathIdx = args.indexOf("--path");
  if (pathIdx !== -1) {
    const pathArg = args[pathIdx + 1];
    if (!pathArg) {
      throw new CliError({ message: "--path requires a directory" });
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
      message: `${bunVersion()} (${bunPath})`,
      fixable: false,
    });
  } else {
    logger.check({ name: "bun", status: "error", message: "not on PATH", fixable: false });
    errors++;
  }

  if (pathExists(parent)) {
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
  if (pathExists(desktopFix)) {
    logger.check({ name: "kimi-fix", status: "ok", message: desktopFix, fixable: false });
  } else if (pathExists(repoFix)) {
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

async function runScaffold(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const noInstall = args.includes("--no-install");
  const noGit = args.includes("--no-git");
  const noSecrets = args.includes("--no-secrets");
  const open = args.includes("--open");
  const filtered = args.filter(
    (a) => !a.startsWith("--")
  );

  const name = filtered[0];
  if (!NAME_RE.test(name)) {
    throw new CliError({ message: `Invalid project name: ${name}` });
  }

  const parent = resolveParent(filtered);
  const projectDir = join(parent, name);

  if (pathExists(projectDir) && !force) {
    throw new CliError({ message: `Directory already exists: ${projectDir} (use --force to overwrite)` });
  }

  logger.section(`Creating ${name}`);
  logger.info(`Path: ${projectDir}`);

  if (dryRun) {
    logger.info(`  [dry-run] mkdir ${projectDir}`);
    logger.info(`  [dry-run] resolveDevSecrets() — GITHUB_TOKEN + NPM_TOKEN from Bun.secrets`);
    logger.info(`  [dry-run] bun init -y (cwd=${projectDir})`);
    logger.info(`  [dry-run] kimi-fix ${projectDir}`);
    if (open) logger.info(`  [dry-run] --open: would launch browser`);
    logger.info("Dry run complete. Remove --dry-run to create.");
    return 0;
  }

  // Resolve dev secrets from Bun.secrets before spawning child processes
  // Skip with --no-secrets when tokens are already in env (e.g. CI)
  if (!noSecrets) {
    await resolveDevSecrets();
  }

  makeDir(projectDir, { recursive: true });
  const initArgs = ["init", "-y"]
  if (noGit) initArgs.push("--no-git");
  await $`bun ${initArgs}`.cwd(projectDir).quiet();

  const desktopFix = join(toolsDir(), "kimi-fix.ts");
  const fixScript = pathExists(desktopFix) ? desktopFix : join(import.meta.dir, "kimi-fix.ts");
  const fixArgs = [fixScript, projectDir];
  if (noInstall) fixArgs.push("--no-install");
  const proc = Bun.spawn(["bun", "run", ...fixArgs], {
    cwd: parent,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await readableStreamToText(proc.stdout);
  const stderr = await readableStreamToText(proc.stderr);

  for (const line of (stdout + stderr).split("\n")) {
    if (line.trim()) await writeStdoutLine(line);
  }

  if (exitCode !== 0) {
    logger.warn(`kimi-fix exited ${exitCode} — review output above`);
  }

  if (open) {
    Bun.openInEditor(projectDir);
  }

  logger.section("Next Steps");
  logger.info(`  cd ${projectDir}`);
  logger.info("  bun run check:fast");
  logger.info("  kimi login");
  logger.info("  kimi-doctor --quick");
  logger.info(`Project ${name} scaffolded.`);
  return exitCode !== 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const filtered = args.filter((a) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    return filtered.length === 0 ? 1 : 0;
  }

  if (filtered[0] === "doctor") {
    const parent = resolveParent(filtered.slice(1));
    return runDoctor(parent);
  }

  return runScaffold(args);
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        e instanceof CliError
          ? e
          : new CliError({
              message: e instanceof Error ? e.message : String(e),
            }),
    }),
    { toolName: "kimi-new", logger }
  );
  process.exit(exitCode);
}
