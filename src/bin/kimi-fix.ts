#!/usr/bin/env bun
/**
 * kimi-fix — Auto-initialize missing project files
 * Usage:
 *   kimi-fix <project-path> [--dry-run]
 *   kimi-fix fix <project-path> [--dry-run]
 *   kimi-fix doctor [project-path]
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { makeDir, pathExists } from "../lib/bun-io.ts";
import { join, basename, resolve } from "path";
import { $ } from "bun";
import { projectMcpStub } from "../lib/mcp-config.ts";
import { buildAgentsMd } from "../lib/scaffold-agents.ts";
import { checkScaffold } from "../lib/scaffold-doctor.ts";
import {
  OXFMTRC,
  OXLINTRC,
  CI_WORKFLOW,
  TSCONFIG,
  BUN_GLOBALS,
  GITIGNORE,
  ENV_EXAMPLE,
  BUNFIG,
  KIMI_SKILLS_README,
  CODE_REFERENCES_TEMPLATE,
  INDEX_TEMPLATE,
  generateReadme,
  generateContext,
} from "../lib/scaffold-templates.ts";
import { Effect } from "effect";
import { getProjectName } from "../lib/utils.ts";
import { runTool, scrubProcessGitEnv } from "../lib/tool-runner.ts";
import { ensureQualityTooling } from "../lib/scaffold-quality.ts";
import { aggregateChecks } from "../lib/health-check.ts";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  detectProfileDrift,
  filterScaffoldArgv,
  renderDxConfig,
  resolveScaffoldProfile,
  scaffoldProfileScripts,
  type ScaffoldProfile,
} from "../lib/scaffold-profiles.ts";
import { parseKimiModules, scaffoldKimiModules } from "../lib/scaffold-modules.ts";

const logger = createLogger(Bun.argv, "kimi-fix");
const TOOLCHAIN_ROOT = join(import.meta.dir, "..", "..");

async function readToolchainScript(name: string): Promise<string> {
  const templatePath = join(TOOLCHAIN_ROOT, "scripts", name);
  if (!pathExists(templatePath)) {
    throw new Error(`Missing toolchain template: ${templatePath}`);
  }
  return Bun.file(templatePath).text();
}

async function readLintBannedTermsTemplate(): Promise<string> {
  return readToolchainScript("lint-banned-terms.ts");
}

async function readScaffoldCheckScript(): Promise<string> {
  const raw = await readToolchainScript("check.ts");
  return raw.replace('from "../src/lib/test-gates.ts"', 'from "./test-gates.ts"');
}

async function readScaffoldRunTestsScript(): Promise<string> {
  const raw = await readToolchainScript("run-tests.ts");
  return raw.replace('from "../src/lib/test-gates.ts"', 'from "./test-gates.ts"');
}

async function readScaffoldTestGatesScript(): Promise<string> {
  return Bun.file(join(TOOLCHAIN_ROOT, "src", "lib", "test-gates.ts")).text();
}

async function readScaffoldReadmeSyncScript(): Promise<string> {
  return Bun.file(join(TOOLCHAIN_ROOT, "src", "lib", "readme-sync.ts")).text();
}

function stepLog(step: string, msg: string) {
  logger.info(`  → ${step}: ${msg}`);
}

function dryLog(step: string, msg: string) {
  logger.info(`  [dry-run] ${step}: ${msg}`);
}

async function delegateTool(
  tool: string,
  args: string[],
  project: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    dryLog(tool, `bun run ~/.kimi-code/tools/${tool}.ts ${args.join(" ")} (cwd=${project})`);
    return;
  }

  logger.info(`  → ${tool} ${args.join(" ")}`);
  try {
    const result = await runTool(tool, args, { cwd: project });
    for (const line of result.stdout.split("\n")) {
      if (line.trim()) logger.line(`    ${line}`);
    }
    for (const line of result.stderr.split("\n")) {
      if (line.trim()) logger.line(`    ${line}`);
    }
    if (result.error) {
      logger.warn(`${tool}: ${result.error}, continuing...`);
    } else if (result.exitCode !== 0) {
      logger.warn(`${tool} failed (exit ${result.exitCode}), continuing...`);
    }
  } catch (e: unknown) {
    logger.warn(`${tool}: ${e instanceof Error ? e.message : String(e)}, continuing...`);
  }
}

async function writeFile(path: string, content: string, dryRun: boolean) {
  if (dryRun) {
    dryLog("write", path);
    return;
  }
  await Bun.write(path, content);
}

async function runDoctor(projectDir: string): Promise<number> {
  const checks = await checkScaffold(projectDir);
  const report = aggregateChecks("kimi-fix", checks);
  logger.printHealthReport(report);
  if (report.errorCount > 0) {
    return 1;
  }
  if (report.warnCount > 0) {
    logger.info("Run 'kimi-fix' to repair");
    return 1;
  }
  logger.info("Scaffold complete");
  return 0;
}

async function runFix(project: string, dryRun: boolean, profile: ScaffoldProfile): Promise<void> {
  logger.section(`Fixing ${basename(project)}`);
  logger.info(`Path: ${project}`);
  logger.info(`Profile: ${profile}`);

  const drift = detectProfileDrift(project, profile);
  if (drift) {
    logger.warn(`Profile drift: ${drift}`);
  }

  if (!pathExists(join(project, ".git"))) {
    stepLog("git", "initializing repo...");
    if (!dryRun) {
      await $`git -C ${project} init`.quiet();
      const userName = await $`git config --global user.name`.nothrow().quiet();
      const userEmail = await $`git config --global user.email`.nothrow().quiet();
      await $`git -C ${project} config user.name ${userName.stdout.toString().trim() || "Developer"}`.quiet();
      await $`git -C ${project} config user.email ${userEmail.stdout.toString().trim() || "dev@localhost"}`.quiet();
    }
  } else {
    stepLog("git", "repo already exists");
  }

  await Promise.all([
    delegateTool("kimi-governance", ["fix"], project, dryRun),
    delegateTool("kimi-context-gen", ["update"], project, dryRun),
    delegateTool("kimi-guardian", ["fix"], project, dryRun),
    delegateTool("kimi-githooks", ["install"], project, dryRun),
  ]);

  const readmePath = join(project, "README.md");
  if (!pathExists(readmePath)) {
    stepLog("readme", "creating README.md...");
    if (dryRun) {
      dryLog("write", readmePath);
    } else {
      await generateReadme(project, getProjectName);
    }
  }

  const contextPath = join(project, "CONTEXT.md");
  if (!pathExists(contextPath)) {
    stepLog("context", "creating CONTEXT.md...");
    if (dryRun) {
      dryLog("write", contextPath);
    } else {
      await generateContext(project, getProjectName);
    }
  }

  const envExample = join(project, ".env.example");
  if (!pathExists(envExample)) {
    if (pathExists(join(project, ".env"))) {
      stepLog("env", "creating .env.example from .env...");
      if (!dryRun) {
        const envContent = await Bun.file(join(project, ".env")).text();
        const example = envContent
          .split("\n")
          .map((line) => {
            const match = line.match(/^([A-Z_][A-Z0-9_]*)=.*/);
            return match ? `${match[1]}=replace_me` : line;
          })
          .join("\n");
        await Bun.write(
          envExample,
          example + "\n# Auto-generated from .env — replace placeholder values\n"
        );
      }
    } else {
      stepLog("env", "creating .env.example template...");
      await writeFile(envExample, ENV_EXAMPLE, dryRun);
    }
  }

  if (!pathExists(join(project, ".gitignore"))) {
    stepLog("gitignore", "creating...");
    await writeFile(join(project, ".gitignore"), GITIGNORE, dryRun);
  }

  if (!pathExists(join(project, "bunfig.toml"))) {
    stepLog("bunfig", "creating...");
    await writeFile(join(project, "bunfig.toml"), BUNFIG, dryRun);
  }

  if (!pathExists(join(project, ".oxfmtrc.json"))) {
    stepLog("oxfmt", "creating .oxfmtrc.json...");
    await writeFile(join(project, ".oxfmtrc.json"), OXFMTRC, dryRun);
  }
  if (!pathExists(join(project, ".oxlintrc.json"))) {
    stepLog("oxlint", "creating .oxlintrc.json...");
    await writeFile(join(project, ".oxlintrc.json"), OXLINTRC, dryRun);
  }

  const agentsPath = join(project, "AGENTS.md");
  if (!pathExists(agentsPath)) {
    stepLog("agents", "creating AGENTS.md...");
    await writeFile(agentsPath, buildAgentsMd(await getProjectName(project)), dryRun);
  }
  const codeRefsPath = join(project, "CODE_REFERENCES.md");
  if (!pathExists(codeRefsPath)) {
    stepLog("agents", "creating CODE_REFERENCES.md...");
    await writeFile(codeRefsPath, CODE_REFERENCES_TEMPLATE, dryRun);
  }

  const kimiCodeDir = join(project, ".kimi-code");
  const projectMcp = join(kimiCodeDir, "mcp.json");
  if (!pathExists(projectMcp)) {
    stepLog("kimi-code", "creating .kimi-code/mcp.json...");
    if (!dryRun) makeDir(kimiCodeDir, { recursive: true });
    await writeFile(projectMcp, projectMcpStub(), dryRun);
  }
  const kimiSkillsReadme = join(kimiCodeDir, "skills", "README.md");
  if (!pathExists(kimiSkillsReadme)) {
    stepLog("kimi-code", "creating .kimi-code/skills/README.md...");
    if (!dryRun) makeDir(join(kimiCodeDir, "skills"), { recursive: true });
    await writeFile(kimiSkillsReadme, KIMI_SKILLS_README, dryRun);
  }

  if (!pathExists(join(project, "dx.config.toml"))) {
    stepLog("dx", `creating dx.config.toml (${profile} profile)...`);
    const dxContent = renderDxConfig(profile, await getProjectName(project));
    await writeFile(join(project, "dx.config.toml"), dxContent, dryRun);
  }

  if (!pathExists(join(project, "tsconfig.json"))) {
    stepLog("tsconfig", "creating tsconfig.json...");
    await writeFile(join(project, "tsconfig.json"), TSCONFIG, dryRun);
  }

  const globalsPath = join(project, "src", "bun-globals.d.ts");
  if (!pathExists(globalsPath)) {
    stepLog("types", "creating src/bun-globals.d.ts...");
    if (!dryRun) makeDir(join(project, "src"), { recursive: true });
    await writeFile(globalsPath, BUN_GLOBALS, dryRun);
  }

  const indexPath = join(project, "src", "index.ts");
  if (profile === "app" && !pathExists(indexPath)) {
    stepLog("entry", "creating src/index.ts starter...");
    if (!dryRun) makeDir(join(project, "src"), { recursive: true });
    await writeFile(indexPath, INDEX_TEMPLATE, dryRun);
  }

  const scriptFiles: Array<{ name: string; content: () => Promise<string> }> = [
    { name: "lint-banned-terms.ts", content: readLintBannedTermsTemplate },
    { name: "test-gates.ts", content: readScaffoldTestGatesScript },
    { name: "check.ts", content: readScaffoldCheckScript },
    { name: "run-tests.ts", content: readScaffoldRunTestsScript },
    { name: "readme-sync.ts", content: readScaffoldReadmeSyncScript },
  ];
  for (const { name, content } of scriptFiles) {
    const scriptPath = join(project, "scripts", name);
    if (!pathExists(scriptPath)) {
      stepLog("scripts", `creating scripts/${name}...`);
      if (!dryRun) makeDir(join(project, "scripts"), { recursive: true });
      await writeFile(scriptPath, await content(), dryRun);
    }
  }

  await ensureQualityTooling(project, dryRun, stepLog, profile);

  if (!pathExists(join(project, ".github", "workflows", "ci.yml"))) {
    stepLog("ci", "creating CI template...");
    if (!dryRun) makeDir(join(project, ".github", "workflows"), { recursive: true });
    await writeFile(join(project, ".github", "workflows", "ci.yml"), CI_WORKFLOW, dryRun);
  }

  const profileScripts = await scaffoldProfileScripts(project, profile, dryRun);
  if (profileScripts.copied.length > 0) {
    stepLog("profile", `copied ${profileScripts.copied.length} toolchain script(s)`);
  }
  if (profileScripts.skipped.length > 0) {
    stepLog("profile", `skipped ${profileScripts.skipped.length} existing toolchain script(s)`);
  }

  const modules = parseKimiModules();
  const moduleResult = await scaffoldKimiModules(project, modules, dryRun);
  if (moduleResult.filesWritten.length > 0) {
    stepLog(
      "modules",
      `scaffolded ${moduleResult.modules.join(", ")} (${moduleResult.filesWritten.length} file(s))`
    );
  }
  if (moduleResult.skipped.length > 0) {
    stepLog("modules", `skipped ${moduleResult.skipped.length} existing module file(s)`);
  }

  logger.section("Next Steps");
  logger.line("  1. Review generated files");
  logger.line("  2. Replace @team in CODEOWNERS with actual username");
  logger.line("  3. Add copyright holder to LICENSE");
  logger.line("  4. Customize AGENTS.md one-line project description");
  logger.line("  5. Run 'bun run check' (or 'bun run check:fast' for unit-only gate)");
  logger.line("  6. Run 'kimi-governance score' to check project health");
  logger.line("  7. Run 'kimi-doctor --quick' to verify everything");
  if (dryRun) {
    logger.info("Dry run complete. Remove --dry-run to apply.");
  } else {
    logger.info("Fix complete. Review changes before committing.");
  }
}

function printHelp() {
  logger.line("Usage:");
  logger.line("  kimi-fix <project-path> [--dry-run] [--profile app|toolchain]");
  logger.line("  kimi-fix fix <project-path> [--dry-run] [--profile app|toolchain]");
  logger.line("  kimi-fix doctor [project-path]");
  logger.line("");
  logger.line("Fixes missing project scaffolding:");
  logger.line("  - git init, governance files, CONTEXT.md, guardian baseline, git hooks");
  logger.line("  - AGENTS.md, .env.example, .gitignore, bunfig.toml, quality scripts, CI");
  logger.line("  - profile-specific dx.config.toml, finish-work scripts (toolchain)");
  logger.line(
    "  - KIMI_MODULES domain effects (doctor, image, clock, uuid, http, trading, db, terminal)"
  );
}

async function main(): Promise<number> {
  scrubProcessGitEnv();

  const rawArgs = Bun.argv.slice(2);
  const profile = resolveScaffoldProfile(rawArgs);
  const args = filterScaffoldArgv(rawArgs.filter((a) => a !== "--dry-run"));
  const dryRun = rawArgs.includes("--dry-run");

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return args.length === 0 ? 1 : 0;
  }

  const command = args[0];

  if (command === "doctor") {
    const project = resolve(args[1] || Bun.cwd);
    if (!pathExists(project)) {
      logger.error(`Directory does not exist: ${project}`);
      return 1;
    }
    return await runDoctor(project);
  }

  const projectPath = command === "fix" ? args[1] : command === "doctor" ? args[1] : args[0];
  if (!projectPath || projectPath === "fix") {
    printHelp();
    return 1;
  }

  const project = resolve(projectPath.replace(/\/$/, ""));
  if (!pathExists(project)) {
    logger.error(`Directory does not exist: ${project}`);
    return 1;
  }

  await runFix(project, dryRun, profile);
  return 0;
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-fix", logger }
  );
  process.exit(exitCode);
}
