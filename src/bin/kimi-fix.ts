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
  DX_CONFIG,
  GITIGNORE,
  ENV_EXAMPLE,
  BUNFIG,
  KIMI_SKILLS_README,
} from "../lib/scaffold-templates.ts";
import { getProjectName, runTool, printSection } from "../lib/utils.ts";
import { ensureQualityTooling } from "../lib/scaffold-quality.ts";

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

function log(step: string, msg: string) {
  console.log(`  → ${step}: ${msg}`);
}

function dry(step: string, msg: string) {
  console.log(`  [dry-run] ${step}: ${msg}`);
}

async function delegateTool(
  tool: string,
  args: string[],
  project: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    dry(tool, `bun run ~/.kimi-code/tools/${tool}.ts ${args.join(" ")} (cwd=${project})`);
    return;
  }

  console.log(`  → ${tool} ${args.join(" ")}`);
  try {
    const result = await runTool(tool, args, { cwd: project });
    for (const line of result.stdout.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }
    for (const line of result.stderr.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }
    if (result.error) {
      console.log(`    ⚠ ${tool}: ${result.error}, continuing...`);
    } else if (result.exitCode !== 0) {
      console.log(`    ⚠ ${tool} failed (exit ${result.exitCode}), continuing...`);
    }
  } catch (e: unknown) {
    console.log(`    ⚠ ${tool}: ${e instanceof Error ? e.message : String(e)}, continuing...`);
  }
}

async function writeFile(path: string, content: string, dryRun: boolean) {
  if (dryRun) {
    dry("write", path);
    return;
  }
  await Bun.write(path, content);
}

async function runDoctor(projectDir: string): Promise<number> {
  printSection("kimi-fix Doctor");
  const checks = await checkScaffold(projectDir);
  let errors = 0;
  let warns = 0;

  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    const fixTag = check.fixable ? " [fixable]" : "";
    console.log(`  ${icon} ${check.name}: ${check.message}${fixTag}`);
    if (check.status === "error") errors++;
    if (check.status === "warn") warns++;
  }

  console.log("");
  if (errors > 0) {
    console.log(`  ✗ ${errors} error(s), ${warns} warning(s)`);
    return 1;
  }
  if (warns > 0) {
    console.log(`  ⚠ ${warns} warning(s) — run kimi-fix to repair`);
    return 1;
  }
  console.log("  ✓ Scaffold complete");
  return 0;
}

async function runFix(project: string, dryRun: boolean): Promise<void> {
  console.log(`=== Fixing ${basename(project)} ===`);
  console.log(`  Path: ${project}`);
  console.log("");

  if (!existsSync(join(project, ".git"))) {
    log("git", "initializing repo...");
    if (!dryRun) {
      await $`git -C ${project} init`.quiet();
      const userName = await $`git config --global user.name`.nothrow().quiet();
      const userEmail = await $`git config --global user.email`.nothrow().quiet();
      await $`git -C ${project} config user.name ${userName.stdout.toString().trim() || "Developer"}`.quiet();
      await $`git -C ${project} config user.email ${userEmail.stdout.toString().trim() || "dev@localhost"}`.quiet();
    }
  } else {
    log("git", "repo already exists");
  }

  await delegateTool("kimi-governance", ["fix"], project, dryRun);
  await delegateTool("kimi-context-gen", ["update"], project, dryRun);
  await delegateTool("kimi-guardian", ["fix"], project, dryRun);
  await delegateTool("kimi-githooks", ["install"], project, dryRun);

  const envExample = join(project, ".env.example");
  if (!existsSync(envExample)) {
    if (existsSync(join(project, ".env"))) {
      log("env", "creating .env.example from .env...");
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
      log("env", "creating .env.example template...");
      await writeFile(envExample, ENV_EXAMPLE, dryRun);
    }
  }

  if (!existsSync(join(project, ".gitignore"))) {
    log("gitignore", "creating...");
    await writeFile(join(project, ".gitignore"), GITIGNORE, dryRun);
  }

  if (!existsSync(join(project, "bunfig.toml"))) {
    log("bunfig", "creating...");
    await writeFile(join(project, "bunfig.toml"), BUNFIG, dryRun);
  }

  if (!existsSync(join(project, ".oxfmtrc.json"))) {
    log("oxfmt", "creating .oxfmtrc.json...");
    await writeFile(join(project, ".oxfmtrc.json"), OXFMTRC, dryRun);
  }
  if (!existsSync(join(project, ".oxlintrc.json"))) {
    log("oxlint", "creating .oxlintrc.json...");
    await writeFile(join(project, ".oxlintrc.json"), OXLINTRC, dryRun);
  }

  const agentsPath = join(project, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    log("agents", "creating AGENTS.md...");
    await writeFile(agentsPath, buildAgentsMd(await getProjectName(project)), dryRun);
  }

  const kimiCodeDir = join(project, ".kimi-code");
  const projectMcp = join(kimiCodeDir, "mcp.json");
  if (!existsSync(projectMcp)) {
    log("kimi-code", "creating .kimi-code/mcp.json...");
    if (!dryRun) mkdirSync(kimiCodeDir, { recursive: true });
    await writeFile(projectMcp, projectMcpStub(), dryRun);
  }
  const kimiSkillsReadme = join(kimiCodeDir, "skills", "README.md");
  if (!existsSync(kimiSkillsReadme)) {
    log("kimi-code", "creating .kimi-code/skills/README.md...");
    if (!dryRun) mkdirSync(join(kimiCodeDir, "skills"), { recursive: true });
    await writeFile(kimiSkillsReadme, KIMI_SKILLS_README, dryRun);
  }

  if (!existsSync(join(project, "dx.config.toml"))) {
    log("dx", "creating dx.config.toml...");
    await writeFile(join(project, "dx.config.toml"), DX_CONFIG, dryRun);
  }

  if (!existsSync(join(project, "tsconfig.json"))) {
    log("tsconfig", "creating tsconfig.json...");
    await writeFile(join(project, "tsconfig.json"), TSCONFIG, dryRun);
  }

  const globalsPath = join(project, "src", "bun-globals.d.ts");
  if (!existsSync(globalsPath)) {
    log("types", "creating src/bun-globals.d.ts...");
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
      log("scripts", `creating scripts/${name}...`);
      if (!dryRun) mkdirSync(join(project, "scripts"), { recursive: true });
      await writeFile(scriptPath, await content(), dryRun);
    }
  }

  await ensureQualityTooling(project, dryRun, log);

  if (!existsSync(join(project, ".github", "workflows", "ci.yml"))) {
    log("ci", "creating CI template...");
    if (!dryRun) mkdirSync(join(project, ".github", "workflows"), { recursive: true });
    await writeFile(join(project, ".github", "workflows", "ci.yml"), CI_WORKFLOW, dryRun);
  }

  console.log("");
  console.log("── Next Steps ────────────────────────────────────────────────");
  console.log("  1. Review generated files");
  console.log("  2. Replace @team in CODEOWNERS with actual username");
  console.log("  3. Add copyright holder to LICENSE");
  console.log("  4. Customize AGENTS.md one-line project description");
  console.log("  5. Run 'bun run check' (or 'bun run check:fast' for unit-only gate)");
  console.log("  6. Run 'kimi-governance score' to check project health");
  console.log("  7. Run 'kimi-doctor --quick' to verify everything");
  console.log("");
  if (dryRun) {
    console.log("✓ Dry run complete. Remove --dry-run to apply.");
  } else {
    console.log("✓ Fix complete. Review changes before committing.");
  }
}

function printHelp() {
  console.log("Usage:");
  console.log("  kimi-fix <project-path> [--dry-run]");
  console.log("  kimi-fix fix <project-path> [--dry-run]");
  console.log("  kimi-fix doctor [project-path]");
  console.log("");
  console.log("Fixes missing project scaffolding:");
  console.log("  - git init, governance files, CONTEXT.md, guardian baseline, git hooks");
  console.log("  - AGENTS.md, .env.example, .gitignore, bunfig.toml, quality scripts, CI");
}

async function main() {
  const args = Bun.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter((a) => a !== "--dry-run");

  if (filtered.length === 0 || filtered[0] === "--help" || filtered[0] === "-h") {
    printHelp();
    process.exit(filtered.length === 0 ? 1 : 0);
  }

  const command = filtered[0];

  if (command === "doctor") {
    const project = resolve(filtered[1] || Bun.cwd);
    if (!existsSync(project)) {
      console.log(`✗ Directory does not exist: ${project}`);
      process.exit(1);
    }
    process.exit(await runDoctor(project));
  }

  const projectPath =
    command === "fix" ? filtered[1] : command === "doctor" ? filtered[1] : filtered[0];
  if (!projectPath || projectPath === "fix") {
    printHelp();
    process.exit(1);
  }

  const project = resolve(projectPath.replace(/\/$/, ""));
  if (!existsSync(project)) {
    console.log(`✗ Directory does not exist: ${project}`);
    process.exit(1);
  }

  await runFix(project, dryRun);
}

main().catch((err) => {
  console.error("kimi-fix failed:", err.message);
  process.exit(1);
});
