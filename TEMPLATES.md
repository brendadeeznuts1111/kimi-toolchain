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

# Test — fail-fast, parallel where safe
bun run test

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
| `.oxfmtrc.json` |        | oxfmt formatter config               |

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
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "lint": "oxlint src test scripts"
  },
  "devDependencies": {
    "oxfmt": "latest",
    "oxlint": "latest"
  }
}
```

Install: `bun add -d oxfmt oxlint`

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
saveTextLockfile = true
# Trusted dependencies with postinstall scripts
# Auto-populated by: bun run ~/.kimi-code/tools/kimi-guardian.ts check
trustedDependencies = []

[install.cache]
dir = "~/.bun/install/cache"
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

````markdown
# Agent Guide — {Project Name}

## Project

One-line description of what this does.

## Runtime

- **Bun** `>=1.3.14` — check `bun --version`
- Prefer Bun-native APIs: `Bun.file`, `Bun.serve`, `Bun.hash`, `Bun.sleep`
- No Node APIs unless Bun lacks equivalent (see `~/.kimi-code/AGENTS.md` for full table)

## Formatting & lint

- **oxfmt** — `.oxfmtrc.json`, `bun run format` / `bun run format:check`
- **oxlint** — `.oxlintrc.json`, `bun run lint`
- Run `bun run format` before commit; CI uses `format:check` + `lint`

## Conventions

- Zero re-export shims — import from canonical source
- Inline single-use variables and private methods
- `trash` > `rm`
- Read-only checks before mutation (`--dry-run`)
- Use `Bun.env` not `process.env`
- Use `Bun.cwd` not `process.cwd()`
- Use `Bun.argv` not `process.argv`
- Use `Uint8Array` not `Buffer`

## Commands

```bash
bun run dev           # Dev server (auto-port)
bun run test          # Tests (fail-fast)
bun run typecheck     # tsc --noEmit
bun run format        # oxfmt --write .
bun run format:check  # oxfmt --check . (CI)
bun run lint          # oxlint
bun run fix           # Auto-fix scaffolding
```
````

## Quality Gates

```bash
bun run ~/.kimi-code/tools/kimi-guardian.ts check       # Supply chain security
bun run ~/.kimi-code/tools/kimi-governance.ts score     # R-Score
bun run ~/.kimi-code/tools/kimi-context-gen.ts scan     # Context freshness
bun run ~/.kimi-code/tools/kimi-githooks.ts install     # Git hooks
bun run ~/.kimi-code/tools/kimi-resource-governor.ts limits
bun run ~/.kimi-code/tools/kimi-memory.ts stats
bun run ~/.kimi-code/tools/kimi-debug.ts last
```

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
````

## TypeScript Function Template (Bun-Native)

```typescript
import { $ } from "bun";

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  cmd: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<Result> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd || Bun.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = options.timeoutMs
    ? setTimeout(() => proc.kill("SIGTERM"), options.timeoutMs)
    : null;

  const exitCode = await proc.exited;
  if (timeout) clearTimeout(timeout);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
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
