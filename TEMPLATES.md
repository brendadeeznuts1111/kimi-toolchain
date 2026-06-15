# Project Templates

Elite-grade templates. No hardcoded ports. No brittle assumptions. Bun-native by default.

## CONTEXT.md Template

```markdown
# CONTEXT — {Project Name}

## Domain

What problem does this project solve? Who uses it? What is the single source of truth for data?

## Architecture
```

[High-level diagram or description of layers/data flow]

````

## Tech Stack

| Layer | Choice | Version | Rationale |
|-------|--------|---------|-----------|
| Runtime | Bun | `>=1.3.14` | Native APIs, fast test runner |
| Formatter | oxfmt | latest | Bun-native, Prettier-compatible |
| Linter | oxlint | latest | Fast correctness checks |
| Framework | | | |
| Database | | | |
| Deploy | | | |

## Key Decisions

| Decision | Context | Rejected Alternatives |
|----------|---------|----------------------|
| | | |

## Environment

Required env vars. **Never commit `.env`**. Always provide `.env.example`:

| Var | Purpose | Required? | Default |
|-----|---------|-----------|---------|
| `PORT` | HTTP server port | No | `0` (auto-assign) |
| `DATABASE_URL` | DB connection | Yes | — |
| `LOG_LEVEL` | debug/info/warn/error | No | `info` |

## Commands

```bash
# Dev — auto-assigns port, prints URL
bun run dev

# Test — fail-fast (--bail), unit files concurrent via bunfig
bun run test
bun run test:fast           # unit only @ 100ms
bun run check:fast          # format + lint + typecheck + test:fast

# Typecheck — no emit, strict
bun run typecheck

# Format — write (local) / check (CI)
bun run format
bun run format:check

# Lint — oxlint correctness
bun run lint

# Toolchain fix — auto-repair scaffolding
bun run fix
````

## Port Policy

- **Default to `0`** for auto-assignment. Log the actual port on startup.
- If a fixed port is required, read from `PORT` env var. Document collision handling.
- Never hardcode ports in source. Use `Bun.serve({ port: Number(Bun.env.PORT) || 0 })`.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- No `eval()`, `new Function()`, or dynamic imports from untrusted input.
- Validate all external input with Zod or similar at system boundaries.

## Governance

| Check           | Status | Notes                                |
| --------------- | ------ | ------------------------------------ |
| LICENSE         |        | MIT / Apache-2.0 / BSD — add file    |
| CONTRIBUTING.md |        | PR process, code style, testing      |
| CODEOWNERS      |        | `@username` for critical paths       |
| CHANGELOG.md    |        | Keep a Changelog format              |
| README.md       |        | Quickstart, badges, links            |
| CONTEXT.md      |        | This file — architecture & decisions |
| AGENTS.md       |        | Project agent guide (kimi-fix)       |
| `.oxfmtrc.json` |        | oxfmt formatter config               |
| `tsconfig.json` |        | Bun bundler mode strict TS           |
| `bunfig.toml`   |        | Trusted deps + test coverage gates   |
| `.kimi-code/`   |        | Project MCP stub + skills dir        |

Run `bun run ~/.kimi-code/tools/kimi-governance.ts score` to check project health.

## Decisions

No ADRs yet. Create one: `bun run ~/.kimi-code/tools/kimi-governance.ts adr "<title>"`

## Notes

[Anything else an agent needs to know: conventions, gotchas, tribal knowledge]

````

## .oxfmtrc.json Template

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "ignorePatterns": ["bun.lock", "CHANGELOG.md"]
}
````

## .oxlintrc.json Template

```json
{
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
```

## package.json Scripts Template

```json
{
  "scripts": {
    "test": "bun run scripts/run-tests.ts",
    "test:fast": "bun run scripts/run-tests.ts --fast",
    "test:coverage": "bun run scripts/run-tests.ts --coverage",
    "test:coverage:ci": "bun run scripts/run-tests.ts --ci --coverage",
    "check": "bun run scripts/check.ts",
    "check:fast": "bun run scripts/check.ts --fast --timeout 100",
    "check:dry-run": "bun run scripts/check.ts --dry-run",
    "docs:sync": "bun run scripts/readme-sync.ts --fix",
    "typecheck": "tsc --noEmit",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check -c .oxfmtrc.json .",
    "format:check:ci": "oxfmt --check --threads=4 -c .oxfmtrc.json .",
    "lint": "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
    "lint:terms": "bun run scripts/lint-banned-terms.ts"
  },
  "devDependencies": {
    "oxfmt": "latest",
    "oxlint": "latest",
    "typescript": "latest",
    "@types/bun": "latest"
  }
}
```

Install: `bun add -d oxfmt oxlint typescript @types/bun`

## tsconfig.json Template

Bun bundler mode — per [Bun TypeScript docs](https://bun.com/docs/runtime/typescript):

```json
{
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
```

Run type checking separately: `bun run typecheck` (`tsc --noEmit`). Bun runtime does not typecheck.

## src/bun-globals.d.ts Template

Temporary shims for Bun 1.3+ runtime APIs ahead of `bun-types`. Remove entries as `@types/bun` catches up:

```typescript
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
```

## .env.example Template

```bash
# ── Required ──
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
API_KEY=replace_me_in_dot_env

# ── Optional ──
# PORT=0                    # 0 = auto-assign. Override only if needed.
# LOG_LEVEL=info            # debug | info | warn | error
# NODE_ENV=development      # development | test | production
# BUN_RUNTIME_TRANSPILER_CACHE_PATH=./.bun-cache
```

## bunfig.toml Template

```toml
[install]
# Trusted dependencies with postinstall scripts
# Run `kimi-guardian check` to auto-populate
trustedDependencies = []

[install.cache]
# Global cache directory (shared across projects)
dir = "~/.bun/install/cache"

[test]
# Unit tests run concurrently; smoke tests stay sequential
concurrentTestGlob = ["test/*.unit.test.ts"]
coverageSkipTestFiles = true

coverageThreshold = { lines = 0.35, functions = 0.25 }
```

## dx.config.toml Template

```toml
schemaVersion = 1

[runtime]
packageManager = "bun"
containers = "none"

[quality]
formatter = "oxfmt"
linter = "oxlint"
typecheck = "bun run typecheck"

[kimi]
preflight = true
```

## CHANGELOG.md Template

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

-

### Changed

-

### Deprecated

-

### Removed

-

### Fixed

-

### Security

-
```

## CODEOWNERS Template

```
# Global owner
* @username

# Critical paths
/src/core/ @username
/docs/adr/ @username
```

## AGENTS.md Minimal Template

Scaffolded automatically by `kimi-fix` via `src/lib/scaffold-agents.ts`. Title uses `package.json` `name` (falls back to directory name). Customize the one-line project description after generation.

````markdown
# Agent Guide — {Project Name}

## Project

One-line description of what this does.

## Runtime

- **Bun** `>=1.3.14` — check `bun --version`
- Prefer Bun-native APIs: `Bun.file`, `Bun.serve`, `Bun.hash`, `Bun.sleep`
- No Node APIs unless Bun lacks equivalent (see `~/.kimi-code/AGENTS.md` for full table)

## Global DX First

- Read `/Users/nolarose/.config/dx/AGENTS.md` before project-local setup
- Start with `dx context`, `dx config`, `dx mcp-status`, and `dx mcp-doctor`
- Use `dx package` after dependency changes, then rerun Kimi guardian/governance gates

## Formatting & lint

- **oxfmt** — `.oxfmtrc.json`, `bun run format` / `bun run format:check`
- **oxlint** — `.oxlintrc.json`, `bun run lint`
- Run `bun run format` before commit; CI uses `format:check:ci` + `lint`

## Conventions

- Zero re-export shims — import from canonical source
- Inline single-use variables and private methods
- `trash` > `rm`
- Read-only checks before mutation (`--dry-run`)
- Use `Bun.env` not `process.env`
- Use `Bun.cwd` not `process.cwd()`
- Use `Bun.argv` not `process.argv`
- Use `Uint8Array` not `Buffer`
- Prefer shared tool/logging helpers from `~/.kimi-code/AGENTS.md` over raw subprocess and console patterns

## Commands

```bash
bun run dev           # Dev server (auto-port)
bun run test          # Tests (fail-fast)
bun run typecheck     # tsc --noEmit
bun run format        # oxfmt --write .
bun run format:check  # oxfmt --check . (local)
bun run lint          # oxlint
kimi-fix .            # Auto-fix scaffolding
```

## Quality Gates

```bash
kimi-doctor --agent-ready
kimi-githooks doctor
bun run check:fast
bun run check
kimi-guardian check
kimi-governance score
kimi-context-gen scan
kimi-githooks install
kimi-doctor --quick
```

## Kimi Code

- User MCP: `~/.kimi-code/mcp.json` (unified-shell from toolchain sync)
- Cloudflare MCP default: `cloudflare-api` in user MCP; Cloudflare SSO/OAuth is separate from Wrangler OAuth and `kimi-cloudflare-access` API tokens
- Project override: `.kimi-code/mcp.json` (empty stub unless you add stdio servers)
- Skills: `.kimi-code/skills/<name>/SKILL.md`

## References

- `CONTEXT.md` — domain model and architecture
- `.env.example` — required environment variables
- `docs/adr/` — architecture decision records
- `~/.kimi-code/AGENTS.md` — global agent rules
- `~/.kimi-code/UNIFIED.md` — Kimi Code vs kimi-toolchain map
- `~/.kimi-code/TEMPLATES.md` — scaffold templates (this file)
````

## CI Workflow Template (`.github/workflows/ci.yml`)

```yaml
name: CI

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
```

## Tool Invocation Template (Bun-Native)

```typescript
import { invokeTool } from "./src/lib/tool-runner.ts";

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export async function runToolchainCommand(
  toolPath: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<Result> {
  const result = await invokeTool(toolPath, args, {
    cwd: options.cwd ?? Bun.cwd,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: 1_048_576,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
}
```

## SQLite + Bun Template

```typescript
import { Database } from "bun:sqlite";

const db = new Database("data.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`);

db.close();
```

## File I/O Template (Bun-Native)

```typescript
const text = await Bun.file("config.json").text();
const json = await Bun.file("config.json").json();
await Bun.write("output.txt", "hello");

import { existsSync } from "fs";
if (existsSync("file.txt")) {
  /* ... */
}
```

## Hashing Template (Bun-Native)

```typescript
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("data");
const hash = hasher.digest("hex");
```

## Spawn with Resource Limits Template

```typescript
import { governedSpawn, ParallelGovernor } from "~/.kimi-code/tools/kimi-resource-governor.ts";

const result = await governedSpawn(["bun", "test"], {
  cwd: "/project",
  limits: { maxMemoryMB: 512, wallClockMs: 300000 },
});

const gov = new ParallelGovernor(4);
const tasks = urls.map((url) => gov.run(() => fetch(url).then((r) => r.text())));
await Promise.all(tasks);
```

## Kimi Code MCP — user `~/.kimi-code/mcp.json`

Toolchain seeds this via `bun run sync`. Manual reference:

```json
{
  "mcpServers": {
    "unified-shell": {
      "command": "/absolute/path/to/bun",
      "args": ["run", "/Users/you/.kimi-code/tools/unified-shell-bridge.ts"],
      "env": {
        "TERMINAL_BINDING_ENABLED": "true",
        "KIMI_SHELL_MODE": "unified"
      }
    }
  }
}
```

Tool exposed to Kimi: `mcp__unified-shell__execute`. See `templates/kimi-config-permissions.toml` for `config.toml` permission rules.

## Kimi Code MCP — project `.kimi-code/mcp.json`

Project entries override user-level servers with the same name:

```json
{
  "mcpServers": {}
}
```

Scaffolded by `kimi-fix`. Only add stdio servers in trusted repos.

## Zed ACP — `~/.config/zed/settings.json`

```json
{
  "agent_servers": {
    "Kimi Code CLI": {
      "type": "custom",
      "command": "/Users/you/.kimi-code/bin/kimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

## JetBrains ACP — Configure ACP agents

```json
{
  "agent_servers": {
    "Kimi Code CLI": {
      "command": "/Users/you/.kimi-code/bin/kimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Run `kimi login` in terminal before first IDE session.
