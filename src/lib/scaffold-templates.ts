/**
 * Canonical scaffold templates — single source of truth for kimi-fix.
 * Keep in sync with TEMPLATES.md (validated by unit test).
 */

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

/** Key markers that must exist in scaffold-templates (drift guard). */
export const TEMPLATE_MARKERS: Record<string, string[]> = {
  OXFMTRC: ['"printWidth": 100'],
  CI_WORKFLOW: ["format:check:ci", "test:coverage:ci", "1.3.14"],
  TSCONFIG: ["moduleResolution", "bundler"],
  BUNFIG: ["concurrentTestGlob", "coverageThreshold"],
  GITIGNORE: ["coverage/", ".bun-cache"],
  ENV_EXAMPLE: ["DATABASE_URL", "PORT=0"],
};
