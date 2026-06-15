/**
 * Canonical scaffold templates — single source of truth for kimi-fix.
 * Keep in sync with TEMPLATES.md (validated by unit test).
 */

import { join } from "path";

export const OXFMTRC = `{
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

export const OXLINTRC = `{
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

export const CI_WORKFLOW = `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Format check
        run: bun run format:check:ci

      - name: Lint
        run: bun run lint

      - name: Type check
        run: bun run typecheck

      - name: Test + coverage
        run: bun run test:coverage:ci
`;

export const TSCONFIG = `{
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

export const BUN_GLOBALS = `/**
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

export const DX_CONFIG = `# Project DX + kimi runtime policy
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

export const GITIGNORE = `# Dependencies
node_modules/
.pnp.*

# Environment
.env
.env.local
.env.*.local

# Build outputs
dist/
build/
out/
*.tsbuildinfo
coverage/
.bun-cache

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Editor
.vscode/
.idea/
*.swp
*~
`;

export const ENV_EXAMPLE = `# ── Required ──
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
API_KEY=replace_me_in_dot_env

# ── Optional ──
# PORT=0                    # 0 = auto-assign. Override only if needed.
# LOG_LEVEL=info            # debug | info | warn | error
# NODE_ENV=development      # development | test | production
# BUN_RUNTIME_TRANSPILER_CACHE_PATH=./.bun-cache
`;

export const BUNFIG = `[install]
# Trusted dependencies with postinstall scripts
# Run \`kimi-guardian check\` to auto-populate
trustedDependencies = []

[install.cache]
# Global cache directory (shared across projects)
dir = "~/.bun/install/cache"

[test]
# Unit tests run concurrently; smoke tests stay sequential
concurrentTestGlob = ["test/*.unit.test.ts"]
coverageSkipTestFiles = true

coverageThreshold = { lines = 0.35, functions = 0.25 }
`;

export const KIMI_SKILLS_README = `# Project skills

Place Kimi Code skills in \`.kimi-code/skills/<name>/SKILL.md\`.
User skills: \`~/.kimi-code/skills/\` and \`~/.agents/skills/\`.
See UNIFIED.md.
`;

/** Required package.json scripts added by kimi-fix. */
export const REQUIRED_PACKAGE_SCRIPTS = [
  "test",
  "test:fast",
  "check",
  "check:fast",
  "typecheck",
  "format",
  "format:check",
  "format:check:ci",
  "lint",
  "fix",
] as const;

export const ADR_TEMPLATE = `---
status: proposed
date: {{DATE}}
deciders: {{DECIDERS}}
consulted: []
informed: []
---

# {{TITLE}}

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing or have agreed to implement?

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- 

### Negative

- 

### Neutral

- 

## Alternatives Considered

| Alternative | Pros | Cons | Decision |
|-------------|------|------|----------|
| Option A | | | Rejected |
| Option B | | | Selected |

## References

- 
`;

/** Generate README.md with project name and basic structure. */
export async function generateReadme(
  projectDir: string,
  getProjectName: (dir: string) => Promise<string>
): Promise<string> {
  const filepath = join(projectDir, "README.md");
  const content = `# ${await getProjectName(projectDir)}\n\n## Getting Started\n\n\`\`\`bash\nbun install\nbun run dev\n\`\`\`\n\n## Scripts\n\nSee \`package.json\` for available scripts.\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate CONTRIBUTING.md with basic guidelines. */
export async function generateContributing(projectDir: string): Promise<string> {
  const filepath = join(projectDir, "CONTRIBUTING.md");
  const content = `# Contributing\n\n## Development Setup\n\n\`\`\`bash\nbun install\n\`\`\`\n\n## Pull Request Process\n\n1. Ensure tests pass: \`bun test\`\n2. Update documentation\n3. Open a PR with a clear description\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate LICENSE file with given type (MIT or generic). */
export async function generateLicense(projectDir: string, type: string): Promise<string> {
  const filepath = join(projectDir, "LICENSE");
  const year = new Date().getFullYear();
  let content = "";
  if (type === "MIT") {
    content = `MIT License\n\nCopyright (c) ${year}\n\nPermission is hereby granted...`;
  } else {
    content = `${type} License\n\nCopyright (c) ${year}\n`;
  }
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate .github/CODEOWNERS with default team placeholder. */
export async function generateCodeowners(
  projectDir: string,
  ensureDir: (dir: string) => void
): Promise<string> {
  const filepath = join(projectDir, ".github", "CODEOWNERS");
  ensureDir(join(projectDir, ".github"));
  const content = `# Code Owners\n* @team\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Generate CHANGELOG.md with initial structure. */
export async function generateChangelog(projectDir: string): Promise<string> {
  const filepath = join(projectDir, "CHANGELOG.md");
  const content = `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n## [Unreleased]\n\n### Added\n- Initial setup\n`;
  await Bun.write(filepath, content);
  return filepath;
}

/** Scaffold a new ADR in docs/adr/ with auto-incremented number. */
export async function scaffoldAdr(
  projectDir: string,
  title: string,
  ensureDir: (dir: string) => void
): Promise<string> {
  const adrDir = join(projectDir, "docs", "adr");
  ensureDir(adrDir);

  const existing = [];
  const glob = new Bun.Glob("*.md");
  for await (const file of glob.scan({ cwd: adrDir, absolute: false })) {
    const num = parseInt(file.split("-")[0], 10);
    if (!isNaN(num)) existing.push(num);
  }
  const nextNum = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
  const paddedNum = String(nextNum).padStart(4, "0");

  const slug = title
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `${paddedNum}-${slug}.md`;
  const filepath = join(adrDir, filename);

  const content = ADR_TEMPLATE.replace("{{DATE}}", new Date().toISOString().split("T")[0])
    .replace("{{DECIDERS}}", "@team")
    .replace("{{TITLE}}", title);

  await Bun.write(filepath, content);
  return filepath;
}

/** Key markers that must exist in scaffold-templates (drift guard). */
export const TEMPLATE_MARKERS: Record<string, string[]> = {
  OXFMTRC: ['"printWidth": 100'],
  CI_WORKFLOW: ["format:check:ci", "test:coverage:ci", "1.3.14"],
  TSCONFIG: ["moduleResolution", "bundler"],
  BUNFIG: ["concurrentTestGlob", "coverageThreshold"],
  GITIGNORE: ["coverage/", ".bun-cache"],
  ENV_EXAMPLE: ["DATABASE_URL", "PORT=0"],
};
