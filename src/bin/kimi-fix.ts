#!/usr/bin/env bun
/**
 * kimi-fix — Auto-initialize missing project files
 * Usage:
 *   kimi-fix <project-path> [--dry-run]
 *   kimi-fix fix <project-path> [--dry-run]
 *   kimi-fix doctor [project-path]
 */

import { existsSync, mkdirSync } from "fs";
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
} from "../lib/scaffold-templates.ts";
import {
  FINISH_WORK_CONFIG_TEMPLATE,
  FINISH_WORK_TEMPLATE,
  TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES,
  renderDxConfig,
  renderWorkspaceToml,
  resolveScaffoldProfile,
  filterScaffoldArgv,
  type ScaffoldProfile,
} from "../lib/scaffold-profiles.ts";
import { homeDir } from "../lib/paths.ts";
import { Effect } from "effect";
import { getProjectName } from "../lib/utils.ts";
import { runTool } from "../lib/tool-runner.ts";
import { ensureQualityTooling } from "../lib/scaffold-quality.ts";
import { aggregateChecks } from "../lib/health-check.ts";
import { createCli } from "../lib/cli-contract.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const writer = createCli(Bun.argv, "kimi-fix");
const logger = writer.logger;
const TOOLCHAIN_ROOT = join(import.meta.dir, "..", "..");

async function readToolchainScript(name: string): Promise<string> {
  const templatePath = join(TOOLCHAIN_ROOT, "scripts", name);
  if (!existsSync(templatePath)) {
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
  logger.section(`Fixing ${basename(project)} (${profile} profile)`);
  logger.info(`Path: ${project}`);

  if (!existsSync(join(project, ".git"))) {
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

  const envExample = join(project, ".env.example");
  if (!existsSync(envExample)) {
    if (existsSync(join(project, ".env"))) {
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

  if (!existsSync(join(project, ".gitignore"))) {
    stepLog("gitignore", "creating...");
    await writeFile(join(project, ".gitignore"), GITIGNORE, dryRun);
  }

  if (!existsSync(join(project, "bunfig.toml"))) {
    stepLog("bunfig", "creating...");
    await writeFile(join(project, "bunfig.toml"), BUNFIG, dryRun);
  }

  if (!existsSync(join(project, ".oxfmtrc.json"))) {
    stepLog("oxfmt", "creating .oxfmtrc.json...");
    await writeFile(join(project, ".oxfmtrc.json"), OXFMTRC, dryRun);
  }
  if (!existsSync(join(project, ".oxlintrc.json"))) {
    stepLog("oxlint", "creating .oxlintrc.json...");
    await writeFile(join(project, ".oxlintrc.json"), OXLINTRC, dryRun);
  }

  const projectName = await getProjectName(project);
  const home = homeDir();

  const agentsPath = join(project, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    stepLog("agents", "creating AGENTS.md...");
    await writeFile(agentsPath, buildAgentsMd(projectName, home), dryRun);
  }
  const codeRefsPath = join(project, "CODE_REFERENCES.md");
  if (!existsSync(codeRefsPath)) {
    stepLog("agents", "creating CODE_REFERENCES.md...");
    await writeFile(codeRefsPath, CODE_REFERENCES_TEMPLATE, dryRun);
  }

  const kimiCodeDir = join(project, ".kimi-code");
  const projectMcp = join(kimiCodeDir, "mcp.json");
  if (!existsSync(projectMcp)) {
    stepLog("kimi-code", "creating .kimi-code/mcp.json...");
    if (!dryRun) mkdirSync(kimiCodeDir, { recursive: true });
    await writeFile(projectMcp, projectMcpStub(), dryRun);
  }
  const kimiSkillsReadme = join(kimiCodeDir, "skills", "README.md");
  if (!existsSync(kimiSkillsReadme)) {
    stepLog("kimi-code", "creating .kimi-code/skills/README.md...");
    if (!dryRun) mkdirSync(join(kimiCodeDir, "skills"), { recursive: true });
    await writeFile(kimiSkillsReadme, KIMI_SKILLS_README, dryRun);
  }

  if (!existsSync(join(project, "dx.config.toml"))) {
    stepLog("dx", `creating dx.config.toml (${profile})...`);
    await writeFile(
      join(project, "dx.config.toml"),
      renderDxConfig(profile, projectName, home),
      dryRun
    );
  }

  if (profile === "toolchain" && !existsSync(join(project, "dx", "workspace.toml"))) {
    stepLog("dx", "creating dx/workspace.toml...");
    if (!dryRun) mkdirSync(join(project, "dx"), { recursive: true });
    await writeFile(
      join(project, "dx", "workspace.toml"),
      renderWorkspaceToml(projectName),
      dryRun
    );
  }

  if (!existsSync(join(project, "tsconfig.json"))) {
    stepLog("tsconfig", "creating tsconfig.json...");
    await writeFile(join(project, "tsconfig.json"), TSCONFIG, dryRun);
  }

  const globalsPath = join(project, "src", "bun-globals.d.ts");
  if (!existsSync(globalsPath)) {
    stepLog("types", "creating src/bun-globals.d.ts...");
    if (!dryRun) mkdirSync(join(project, "src"), { recursive: true });
    await writeFile(globalsPath, BUN_GLOBALS, dryRun);
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
    if (!existsSync(scriptPath)) {
      stepLog("scripts", `creating scripts/${name}...`);
      if (!dryRun) mkdirSync(join(project, "scripts"), { recursive: true });
      await writeFile(scriptPath, await content(), dryRun);
    }
  }

  if (profile === "toolchain") {
    const toolchainScripts: Record<string, string> = {
      "finish-work-config.ts": FINISH_WORK_CONFIG_TEMPLATE,
      "finish-work.ts": FINISH_WORK_TEMPLATE,
    };
    for (const name of TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES) {
      const scriptPath = join(project, "scripts", name);
      if (!existsSync(scriptPath)) {
        stepLog("scripts", `creating scripts/${name}...`);
        if (!dryRun) mkdirSync(join(project, "scripts"), { recursive: true });
        await writeFile(scriptPath, toolchainScripts[name], dryRun);
      }
    }
  }

  await ensureQualityTooling(project, dryRun, stepLog, profile);

  if (!existsSync(join(project, ".github", "workflows", "ci.yml"))) {
    stepLog("ci", "creating CI template...");
    if (!dryRun) mkdirSync(join(project, ".github", "workflows"), { recursive: true });
    await writeFile(join(project, ".github", "workflows", "ci.yml"), CI_WORKFLOW, dryRun);
  }

  logger.section("Next Steps");
  logger.line("  1. Review generated files");
  logger.line("  2. Replace @team in CODEOWNERS with actual username");
  logger.line("  3. Add copyright holder to LICENSE");
  logger.line("  4. Customize AGENTS.md one-line project description");
  logger.line("  5. Run 'bun run check' (or 'bun run check:fast' for unit-only gate)");
  logger.line("  6. Run 'kimi-governance score' to check project health");
  logger.line("  7. Run 'kimi-doctor --quick' to verify everything");
  if (profile === "toolchain") {
    logger.line("  8. Run 'bun run finish-work --dry-run' to preview finish-work gates");
  }
  if (dryRun) {
    logger.info("Dry run complete. Remove --dry-run to apply.");
  } else {
    logger.info("Fix complete. Review changes before committing.");
  }
}

function printHelp() {
  logger.line("Usage:");
  logger.line("  kimi-fix <project-path> [--profile app|toolchain] [--dry-run]");
  logger.line("  kimi-fix fix <project-path> [--profile app|toolchain] [--dry-run]");
  logger.line("  kimi-fix doctor [project-path]");
  logger.line("");
  logger.line("Fixes missing project scaffolding:");
  logger.line("  - git init, governance files, CONTEXT.md, guardian baseline, git hooks");
  logger.line("  - AGENTS.md, .env.example, .gitignore, bunfig.toml, quality scripts, CI");
}

async function main(): Promise<number> {
  const positional = writer.flags.positional;
  const profile = resolveScaffoldProfile(positional);
  const dryRun = positional.includes("--dry-run");
  const filtered = filterScaffoldArgv(positional).filter((a: string) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    return filtered.length === 0 ? 1 : 0;
  }

  const command = filtered[0];

  if (command === "doctor") {
    const project = resolve(filtered[1] || Bun.cwd);
    if (!existsSync(project)) {
      logger.error(`Directory does not exist: ${project}`);
      return 1;
    }
    return await runDoctor(project);
  }

  const projectPath =
    command === "fix" ? filtered[1] : command === "doctor" ? filtered[1] : filtered[0];
  if (!projectPath || projectPath === "fix") {
    printHelp();
    return 1;
  }

  const project = resolve(projectPath.replace(/\/$/, ""));
  if (!existsSync(project)) {
    logger.error(`Directory does not exist: ${project}`);
    return 1;
  }

  await runFix(project, dryRun, profile);
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
  { toolName: "kimi-fix", logger }
);
process.exit(exitCode);
