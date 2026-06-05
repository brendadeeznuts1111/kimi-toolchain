#!/usr/bin/env bun
/**
 * kimi-fix — Auto-initialize missing project files
 * Delegates to individual tool fix commands
 * Usage: kimi-fix <project-path> [--dry-run]
 */

import { existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { $ } from "bun";

const TOOLS_DIR = join(Bun.env.HOME || "/tmp", ".kimi-code", "tools");

const OXFMTRC = `{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "ignorePatterns": ["bun.lock", "CHANGELOG.md"]
}
`;

const OXLINTRC = `{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc"],
  "categories": {
    "correctness": "error"
  },
  "rules": {},
  "env": {
    "builtin": true
  }
}
`;

const CI_WORKFLOW = `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format:check

      - name: Lint
        run: bun run lint

      - name: Type check
        run: bun run typecheck

      - name: Test
        run: bun run test
`;

const TSCONFIG = `{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["bun"]
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"]
}
`;

const BUN_GLOBALS = `/**
 * Runtime APIs present in Bun 1.3+ that may lag behind bun-types.
 * Remove entries as @types/bun catches up.
 */
/// <reference types="bun" />

declare module "bun" {
  const cwd: string;
  const pid: number;

  interface BunFile {
    textSync(encoding?: string): string;
  }
}

interface ReadableStream<R = any> {
  [Symbol.asyncIterator](): AsyncIterator<R>;
}
`;

const TOOLCHAIN_ROOT = join(import.meta.dir, "..", "..");

async function readLintBannedTermsTemplate(): Promise<string> {
  const templatePath = join(TOOLCHAIN_ROOT, "scripts", "lint-banned-terms.ts");
  if (!existsSync(templatePath)) {
    throw new Error(`Missing toolchain template: ${templatePath}`);
  }
  return Bun.file(templatePath).text();
}

const DX_CONFIG = `# Project DX + kimi runtime policy
schemaVersion = 1

[runtime]
containers = "none"
packageManager = "bun"

[quality]
formatter = "oxfmt"
linter = "oxlint"
typecheck = "bun run typecheck"

[kimi]
preflight = true
`;

function log(step: string, msg: string) {
  console.log(`  → ${step}: ${msg}`);
}

function dry(step: string, msg: string) {
  console.log(`  [dry-run] ${step}: ${msg}`);
}

async function runTool(tool: string, args: string[], dryRun: boolean) {
  const path = join(TOOLS_DIR, `${tool}.ts`);
  if (!existsSync(path)) {
    console.log(`  ⚠ ${tool}: not found at ${path}`);
    return;
  }

  if (dryRun) {
    dry(tool, `bun run ${path} ${args.join(" ")}`);
    return;
  }

  console.log(`  → ${tool} ${args.join(" ")}`);
  try {
    const proc = Bun.spawn(["bun", "run", path, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await Bun.readableStreamToText(proc.stdout);
    const stderr = await Bun.readableStreamToText(proc.stderr);

    for (const line of stdout.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }
    for (const line of stderr.split("\n")) {
      if (line.trim()) console.log(`    ${line}`);
    }

    if (exitCode !== 0) {
      console.log(`    ⚠ ${tool} failed (exit ${exitCode}), continuing...`);
    }
  } catch (e: any) {
    console.log(`    ⚠ ${tool} failed: ${e.message}, continuing...`);
  }
}

async function writeFile(path: string, content: string, dryRun: boolean) {
  if (dryRun) {
    dry("write", path);
    return;
  }
  await Bun.write(path, content);
}

async function ensureQualityTooling(project: string, dryRun: boolean) {
  const pkgPath = join(project, "package.json");
  if (!existsSync(pkgPath)) return;

  const pkg = (await Bun.file(pkgPath).json()) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts || {};
  const additions: Record<string, string> = {
    test: "bun test",
    check: "bun run format:check && bun run lint && bun run typecheck && bun test",
    typecheck: "tsc --noEmit",
    format: "oxfmt --write .",
    "format:check": "oxfmt --check .",
    lint: "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
    "lint:terms": "bun run scripts/lint-banned-terms.ts",
  };
  let scriptsChanged = false;
  for (const [key, value] of Object.entries(additions)) {
    if (!scripts[key]) {
      scripts[key] = value;
      scriptsChanged = true;
    }
  }
  if (scriptsChanged) {
    log("package.json", "adding format/lint/test scripts...");
    if (!dryRun) {
      pkg.scripts = scripts;
      await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  }

  const devDeps = pkg.devDependencies || {};
  const missingDeps: string[] = [];
  if (!devDeps.oxfmt) missingDeps.push("oxfmt");
  if (!devDeps.oxlint) missingDeps.push("oxlint");
  if (!devDeps.typescript) missingDeps.push("typescript");
  if (!devDeps["@types/bun"]) missingDeps.push("@types/bun");
  if (missingDeps.length > 0) {
    log("deps", `installing ${missingDeps.join(", ")}...`);
    if (!dryRun) {
      await $`bun add -d ${missingDeps}`.cwd(project).quiet();
    }
  }
}

async function main() {
  const args = Bun.argv.slice(2);
  const projectPath = args[0];
  const dryRun = args.includes("--dry-run");

  if (!projectPath || projectPath === "--help" || projectPath === "-h") {
    console.log("Usage: kimi-fix <project-path> [--dry-run]");
    console.log("");
    console.log("Fixes missing project scaffolding by delegating to tools:");
    console.log("  - git init (if not a repo)");
    console.log("  - kimi-governance fix (README, CONTRIBUTING, LICENSE, CODEOWNERS, CHANGELOG)");
    console.log("  - kimi-context-gen update (CONTEXT.md)");
    console.log("  - kimi-guardian fix (lockfile baseline + trusted deps)");
    console.log("  - kimi-githooks install (pre-commit + pre-push)");
    console.log("  - .env.example, .gitignore, bunfig.toml, oxfmt/oxlint, CI template");
    process.exit(projectPath ? 0 : 1);
  }

  const project = projectPath.replace(/\/$/, "");
  if (!existsSync(project)) {
    console.log(`✗ Directory does not exist: ${project}`);
    process.exit(1);
  }

  console.log(`=== Fixing ${basename(project)} ===`);
  console.log(`  Path: ${project}`);
  console.log("");

  // Git init
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

  // Governance files
  await runTool("kimi-governance", ["fix"], dryRun);

  // CONTEXT.md
  await runTool("kimi-context-gen", ["update"], dryRun);

  // Lockfile baseline
  await runTool("kimi-guardian", ["fix"], dryRun);

  // Git hooks
  await runTool("kimi-githooks", ["install"], dryRun);

  // .env.example
  if (existsSync(join(project, ".env")) && !existsSync(join(project, ".env.example"))) {
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
        join(project, ".env.example"),
        example + "\n# Auto-generated from .env — replace placeholder values\n"
      );
    }
  }

  // .gitignore
  if (!existsSync(join(project, ".gitignore"))) {
    log("gitignore", "creating...");
    await writeFile(
      join(project, ".gitignore"),
      `# Dependencies\nnode_modules/\n.pnp.*\n\n# Environment\n.env\n.env.local\n.env.*.local\n\n# Build outputs\ndist/\nbuild/\nout/\n*.tsbuildinfo\n\n# OS\n.DS_Store\nThumbs.db\n\n# Logs\n*.log\nnpm-debug.log*\n\n# Editor\n.vscode/\n.idea/\n*.swp\n*~\n`,
      dryRun
    );
  }

  // bunfig.toml
  if (!existsSync(join(project, "bunfig.toml"))) {
    log("bunfig", "creating...");
    await writeFile(
      join(project, "bunfig.toml"),
      `[install]\n# Trusted dependencies with postinstall scripts\n# Run \`kimi-guardian check\` to auto-populate\ntrustedDependencies = []\n\n[install.cache]\n# Global cache directory (shared across projects)\ndir = "~/.bun/install/cache"\n`,
      dryRun
    );
  }

  // oxfmt / oxlint config
  if (!existsSync(join(project, ".oxfmtrc.json"))) {
    log("oxfmt", "creating .oxfmtrc.json...");
    await writeFile(join(project, ".oxfmtrc.json"), OXFMTRC, dryRun);
  }
  if (!existsSync(join(project, ".oxlintrc.json"))) {
    log("oxlint", "creating .oxlintrc.json...");
    await writeFile(join(project, ".oxlintrc.json"), OXLINTRC, dryRun);
  }

  // dx.config.toml (optional project policy)
  if (!existsSync(join(project, "dx.config.toml"))) {
    log("dx", "creating dx.config.toml...");
    await writeFile(join(project, "dx.config.toml"), DX_CONFIG, dryRun);
  }

  // tsconfig.json (Bun bundler mode — see bun.com/docs/runtime/typescript)
  if (!existsSync(join(project, "tsconfig.json"))) {
    log("tsconfig", "creating tsconfig.json...");
    await writeFile(join(project, "tsconfig.json"), TSCONFIG, dryRun);
  }

  // bun-globals.d.ts (type shims for runtime APIs ahead of bun-types)
  const globalsPath = join(project, "src", "bun-globals.d.ts");
  if (!existsSync(globalsPath)) {
    log("types", "creating src/bun-globals.d.ts...");
    if (!dryRun) {
      mkdirSync(join(project, "src"), { recursive: true });
    }
    await writeFile(globalsPath, BUN_GLOBALS, dryRun);
  }

  // Banned-terms lint (docs/markdown — oxlint does not scan these)
  const lintTermsPath = join(project, "scripts", "lint-banned-terms.ts");
  if (!existsSync(lintTermsPath)) {
    log("lint", "creating scripts/lint-banned-terms.ts...");
    if (!dryRun) mkdirSync(join(project, "scripts"), { recursive: true });
    await writeFile(lintTermsPath, await readLintBannedTermsTemplate(), dryRun);
  }

  // package.json scripts + oxfmt/oxlint devDeps
  await ensureQualityTooling(project, dryRun);

  // CI/CD template
  if (!existsSync(join(project, ".github", "workflows", "ci.yml"))) {
    log("ci", "creating CI template...");
    if (!dryRun) {
      mkdirSync(join(project, ".github", "workflows"), { recursive: true });
    }
    await writeFile(join(project, ".github", "workflows", "ci.yml"), CI_WORKFLOW, dryRun);
  }

  console.log("");
  console.log("── Next Steps ────────────────────────────────────────────────");
  console.log("  1. Review generated files");
  console.log("  2. Replace @replace-me in CODEOWNERS with actual username");
  console.log("  3. Add copyright holder to LICENSE");
  console.log("  4. Run 'bun run check' (format:check + lint + typecheck + test)");
  console.log("  5. Run 'kimi-githooks install' to enable pre-commit/pre-push gates");
  console.log("  6. Run 'kimi-governance score' to check project health");
  console.log("  7. Run 'kimi-doctor' to verify everything");
  console.log("");
  if (dryRun) {
    console.log("✓ Dry run complete. Remove --dry-run to apply.");
  } else {
    console.log("✓ Fix complete. Review changes before committing.");
  }
}

main().catch((err) => {
  console.error("Fix failed:", err.message);
  process.exit(1);
});
