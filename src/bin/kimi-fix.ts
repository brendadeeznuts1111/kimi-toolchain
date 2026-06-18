#!/usr/bin/env bun
import { makeDir, pathExists } from "../lib/bun-io.ts";
/**
 * kimi-fix — Auto-initialize missing project files
 * Usage:
 *   kimi-fix <project-path> [--dry-run]
 *   kimi-fix fix <project-path> [--dry-run]
 *   kimi-fix doctor [project-path]
 */

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
  ENTRY_POINT,
  README_TEMPLATE,
} from "../lib/scaffold-templates.ts";
import {
  FINISH_WORK_CONFIG_TEMPLATE,
  FINISH_WORK_HERDR_TEMPLATE,
  FINISH_WORK_TEMPLATE,
  REVIEWER_PANE_TEMPLATE,
  SCAFFOLD_BUN_IO_TEMPLATE,
  SCAFFOLD_BUN_UTILS_TEMPLATE,
  TOOLCHAIN_SCAFFOLD_LIB_NAMES,
  TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES,
  renderDxConfig,
  scaffoldDxConfigTemplateRel,
  resolveScaffoldProfile,
  filterScaffoldArgv,
  detectProfileDrift,
  ScaffoldProfileError,
  renderTemplate,
  type ScaffoldProfile,
} from "../lib/scaffold-profiles.ts";
import { desktopRoot, homeDir } from "../lib/paths.ts";
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

/** Resolve toolchain root — works from both repo (src/bin/) and runtime (~/.kimi-code/tools/). */
const REPO_ROOT = join(import.meta.dir, "..", "..");
const DESKTOP_ROOT = desktopRoot();
function resolveToolchainRoot(): string {
  // Prefer repo layout when scripts/ exists at repo-relative path
  if (pathExists(join(REPO_ROOT, "scripts"))) return REPO_ROOT;
  // Fall back to synced runtime layout (~/.kimi-code/)
  if (pathExists(join(DESKTOP_ROOT, "scripts"))) return DESKTOP_ROOT;
  // Last resort: assume repo layout
  return REPO_ROOT;
}

async function readToolchainScript(name: string): Promise<string> {
  const templatePath = join(resolveToolchainRoot(), "scripts", name);
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
  return Bun.file(join(resolveToolchainRoot(), "src", "lib", "test-gates.ts")).text();
}

async function readScaffoldReadmeSyncScript(): Promise<string> {
  return Bun.file(join(resolveToolchainRoot(), "src", "lib", "readme-sync.ts")).text();
}

async function readScaffoldScanScript(): Promise<string> {
  const raw = await readToolchainScript("scan.ts");
  return raw.replace('from "../src/lib/upgrade-advisor.ts"', 'from "./lib/upgrade-advisor.ts"');
}

async function readScaffoldUpgradeAdvisorLib(): Promise<string> {
  return Bun.file(join(resolveToolchainRoot(), "src", "lib", "upgrade-advisor.ts")).text();
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
  logger.info(`Profile: ${profile}`);
  logger.info(`Template: templates/scaffold/${scaffoldDxConfigTemplateRel(profile)}`);

  // Bun version guard — scaffolded projects need Bun >= 1.4.0
  const minBun = { major: 1, minor: 4, patch: 0 };
  const [major, minor, patch] = Bun.version.split(".").map(Number);
  const tooOld =
    major < minBun.major ||
    (major === minBun.major && minor < minBun.minor) ||
    (major === minBun.major && minor === minBun.minor && patch < minBun.patch);
  if (tooOld) {
    logger.warn(
      `Bun ${Bun.version} is below minimum ${minBun.major}.${minBun.minor}.${minBun.patch} — scaffolded scripts may not work. Please upgrade: bun upgrade`
    );
  }

  const drift = detectProfileDrift(project, profile);
  if (drift) logger.warn(drift);

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

  // Write entry point + README before governance (governance fix creates its own README)
  const projectName = await getProjectName(project);

  if (!dryRun) makeDir(join(project, "src"), { recursive: true });
  const entryPath = join(project, "src", "index.ts");
  if (!pathExists(entryPath)) {
    stepLog("entry", "creating src/index.ts...");
    await writeFile(entryPath, ENTRY_POINT, dryRun);
  }

  const readmePath = join(project, "README.md");
  if (!pathExists(readmePath)) {
    stepLog("readme", "creating README.md...");
    await writeFile(
      readmePath,
      renderTemplate(README_TEMPLATE, { PROJECT_NAME: projectName }),
      dryRun
    );
  }

  await Promise.all([
    delegateTool("kimi-governance", ["fix"], project, dryRun),
    delegateTool("kimi-context-gen", ["update"], project, dryRun),
    delegateTool("kimi-guardian", ["fix"], project, dryRun),
    delegateTool("kimi-githooks", ["install"], project, dryRun),
  ]);

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

  const home = homeDir();

  const agentsPath = join(project, "AGENTS.md");
  if (!pathExists(agentsPath)) {
    stepLog("agents", "creating AGENTS.md...");
    await writeFile(agentsPath, buildAgentsMd(projectName, home), dryRun);
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
    stepLog("dx", `creating dx.config.toml (${profile})...`);
    await writeFile(
      join(project, "dx.config.toml"),
      renderDxConfig(profile, projectName, home),
      dryRun
    );
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

  const scriptFiles: Array<{ name: string; content: () => Promise<string> }> = [
    { name: "lint-banned-terms.ts", content: readLintBannedTermsTemplate },
    { name: "test-gates.ts", content: readScaffoldTestGatesScript },
    { name: "check.ts", content: readScaffoldCheckScript },
    { name: "run-tests.ts", content: readScaffoldRunTestsScript },
    { name: "readme-sync.ts", content: readScaffoldReadmeSyncScript },
    { name: "scan.ts", content: readScaffoldScanScript },
  ];
  for (const { name, content } of scriptFiles) {
    const scriptPath = join(project, "scripts", name);
    if (!pathExists(scriptPath)) {
      stepLog("scripts", `creating scripts/${name}...`);
      if (!dryRun) makeDir(join(project, "scripts"), { recursive: true });
      await writeFile(scriptPath, await content(), dryRun);
    }
  }

  const upgradeAdvisorLib = join(project, "scripts", "lib", "upgrade-advisor.ts");
  if (!pathExists(upgradeAdvisorLib)) {
    stepLog("scripts", "creating scripts/lib/upgrade-advisor.ts...");
    if (!dryRun) makeDir(join(project, "scripts", "lib"), { recursive: true });
    await writeFile(upgradeAdvisorLib, await readScaffoldUpgradeAdvisorLib(), dryRun);
  }

  if (profile === "toolchain") {
    const toolchainLibs: Record<string, string> = {
      "lib/bun-io.ts": SCAFFOLD_BUN_IO_TEMPLATE,
      "lib/bun-utils.ts": SCAFFOLD_BUN_UTILS_TEMPLATE,
    };
    for (const name of TOOLCHAIN_SCAFFOLD_LIB_NAMES) {
      const libPath = join(project, "scripts", name);
      if (!pathExists(libPath)) {
        stepLog("scripts", `creating scripts/${name}...`);
        if (!dryRun) makeDir(join(project, "scripts", "lib"), { recursive: true });
        await writeFile(libPath, toolchainLibs[name], dryRun);
      }
    }

    const toolchainScripts: Record<string, string> = {
      "finish-work-config.ts": FINISH_WORK_CONFIG_TEMPLATE,
      "finish-work-herdr.ts": FINISH_WORK_HERDR_TEMPLATE,
      "finish-work.ts": FINISH_WORK_TEMPLATE,
      "reviewer-pane.ts": REVIEWER_PANE_TEMPLATE,
    };
    for (const name of TOOLCHAIN_SCAFFOLD_SCRIPT_NAMES) {
      const scriptPath = join(project, "scripts", name);
      if (!pathExists(scriptPath)) {
        stepLog("scripts", `creating scripts/${name}...`);
        if (!dryRun) makeDir(join(project, "scripts"), { recursive: true });
        await writeFile(scriptPath, toolchainScripts[name], dryRun);
      }
    }
  }

  await ensureQualityTooling(project, dryRun, stepLog, profile);

  if (!pathExists(join(project, ".github", "workflows", "ci.yml"))) {
    stepLog("ci", "creating CI template...");
    if (!dryRun) makeDir(join(project, ".github", "workflows"), { recursive: true });
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
  logger.line("");
  logger.line("Docs:");
  logger.line("  TEMPLATES.md                 — full template reference");
  logger.line("  docs/references/bun-runtime-scaffold.md — bunfig.toml defaults explainer");
}

async function main(): Promise<number> {
  const positional = writer.flags.positional;
  let profile: ScaffoldProfile;
  try {
    profile = resolveScaffoldProfile(positional);
  } catch (e) {
    if (e instanceof ScaffoldProfileError) {
      logger.error(e.message);
      return 1;
    }
    throw e;
  }
  const dryRun = positional.includes("--dry-run");
  const filtered = filterScaffoldArgv(positional).filter((a: string) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    return filtered.length === 0 ? 1 : 0;
  }

  const command = filtered[0];

  if (command === "doctor") {
    const project = resolve(filtered[1] || Bun.cwd);
    if (!pathExists(project)) {
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
  if (!pathExists(project)) {
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
