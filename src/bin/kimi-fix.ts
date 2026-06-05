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
    console.log("  - .env.example, .gitignore, bunfig.toml, CI template");
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

  // CI/CD template
  if (!existsSync(join(project, ".github", "workflows", "ci.yml"))) {
    log("ci", "creating CI template...");
    if (!dryRun) {
      mkdirSync(join(project, ".github", "workflows"), { recursive: true });
    }
    await writeFile(
      join(project, ".github", "workflows", "ci.yml"),
      // eslint-disable-next-line no-useless-escape -- bash $vars in embedded CI script
      `name: CI\n\non:\n  push:\n    branches: [main, master]\n  pull_request:\n    branches: [main, master]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n\n      - name: Setup Bun\n        uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: latest\n\n      - name: Install dependencies\n        run: bun install --frozen-lockfile\n\n      - name: Type check\n        run: bun run typecheck || true\n\n      - name: Lint\n        run: bun run lint || true\n\n      - name: Test\n        run: bun test --timeout 30000\n\n      - name: Coverage gate\n        run: |\n          if command -v kimi-governance &>/dev/null; then\n            kimi-governance coverage 70 || exit 1\n          fi\n        shell: bash\n\n      - name: Supply chain check\n        run: |\n          if command -v kimi-guardian &>/dev/null; then\n            kimi-guardian check || exit 1\n          fi\n        shell: bash\n\n      - name: Governance score\n        run: |\n          if command -v kimi-governance &>/dev/null; then\n            score=\$(kimi-governance score 2>/dev/null | grep "Grade:" | grep -o "[A-F]")\n            if [ "\$score" = "F" ] || [ "\$score" = "D" ]; then\n              echo "R-Score too low: \$score"\n              exit 1\n            fi\n          fi\n        shell: bash\n`,
      dryRun
    );
  }

  console.log("");
  console.log("── Next Steps ────────────────────────────────────────────────");
  console.log("  1. Review generated files");
  console.log("  2. Replace @replace-me in CODEOWNERS with actual username");
  console.log("  3. Add copyright holder to LICENSE");
  console.log("  4. Run 'kimi-governance score' to check project health");
  console.log("  5. Run 'kimi-doctor' to verify everything");
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
