# kimi-toolchain — Agent Guide

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding.
> This file is for AI coding agents. It assumes zero prior knowledge of the project.

## Project Overview

`kimi-toolchain` is a Bun-native CLI toolkit that provides project health checks, supply-chain security, governance scoring, session memory, git hooks, and scaffolding automation. It is a meta-project: the tools manage other projects.

- **Repository**: `https://github.com/brendadeeznuts1111/kimi-toolchain`
- **License**: MIT
- **Language**: TypeScript (ESNext, strict mode)
- **Runtime**: Bun >= 1.3.14
- **Zero runtime dependencies** — everything uses Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.spawn`, `Bun.CryptoHasher`, etc.)

## Architecture

### Repo Layout

```
kimi-toolchain/
  src/
    bin/                    # CLI entry points (11 tools)
      ├── kimi-doctor.ts          # Comprehensive diagnostics aggregator
      ├── kimi-fix.ts             # Auto-repair project scaffolding
      ├── kimi-governance.ts      # R-Score, coverage gate, ADR scaffold
      ├── kimi-guardian.ts        # Lockfile integrity + CVE scan
      ├── kimi-memory.ts          # SQLite session store + knowledge graph
      ├── kimi-githooks.ts        # pre-commit / pre-push hook installer
      ├── kimi-context-gen.ts     # CONTEXT.md auto-generator
      ├── kimi-debug.ts           # "What broke?" failure wizard
      ├── kimi-resource-governor.ts  # Resource limits, spawn wrapper, cache
      ├── kimi-release.ts         # Conventional commits + changelog
      ├── kimi-snapshot.ts        # Environment snapshot save/restore
      └── unified-shell-bridge.ts # MCP stdio server for shell execution
    lib/
      ├── utils.ts          # Shared utilities (fs, hash, logging, runTool)
      └── version.ts        # Canonical version (reads package.json)
    hooks/
      ├── postinstall.ts    # Idempotent ~/.kimi-code/ setup
      └── pre-push          # Git hook template
    guardian/
      └── verify.ts         # Thin lockfile verifier wrapper
    drift/
      └── check.ts          # Dependency drift detector
  test/
    └── kimi-doctor.smoke.test.ts   # Smoke tests for all CLI tools
  skills/
    └── kimi-toolchain/
      └── SKILL.md          # Agent decision protocol
  scripts/
    ├── check.ts            # Quality gate runner (--dry-run, --fast, --timeout)
    └── sync-to-desktop.ts  # Repo → ~/.kimi-code/ sync (one-shot or daemon)
```

### Live Runtime (managed by `postinstall`)

When the package is installed (globally or locally), `postinstall.ts` copies sources to:

```
~/.kimi-code/
  tools/              # Copies of src/bin/*.ts
  lib/                # Copies of src/lib/*.ts
  var/                # Runtime state (sessions.db, etc.)
  memory/             # Session store directory
  guardian/           # Lockfile manifest DB
  governor/           # Resource governor DB + cache
  AGENTS.md           # Copied from repo root
  UNIFIED.md          # Copied from repo root
  TEMPLATES.md        # Copied from repo root
```

**Do not edit `~/.kimi-code/` manually.** Use `bun run sync` (or `bun run sync:daemon`) to push repo changes to the live runtime.

### Naming & paths (Kimi Code vs kimi-toolchain)

| Layer              | Product                                           | Path                               |
| ------------------ | ------------------------------------------------- | ---------------------------------- |
| Agent              | **Kimi Code** (`kimi`) — Moonshot Node SEA binary | `~/.kimi-code/bin/kimi`            |
| Toolchain          | **kimi-toolchain** (this repo)                    | `~/kimi-toolchain/`                |
| Runtime extensions | Synced tools/lib/governor                         | `~/.kimi-code/tools/`, `lib/`      |
| Global platform    | **dx**                                            | `~/.config/dx/`, `~/.local/bin/dx` |

- `kimi doctor` — official Kimi Code config check (not `kimi-doctor`).
- `kimi-doctor` — this repo's Bun diagnostics aggregator.
- Clone path should be `~/kimi-toolchain` (matches `package.json` name and GitHub repo).
- Full map: see **UNIFIED.md**. One-shot setup: `bash scripts/unify.sh`.

## Technology Stack

| Layer           | Choice                                                 |
| --------------- | ------------------------------------------------------ |
| Runtime         | Bun >= 1.3.14                                          |
| Language        | TypeScript (strict, ESNext, bundler resolution)        |
| Test runner     | `bun:test` (Bun's built-in test runner)                |
| Database        | SQLite via `bun:sqlite` (WAL mode)                     |
| Config          | `bunfig.toml` (Bun-native TOML)                        |
| Package manager | `bun pm`                                               |
| Shell           | Bun's `$` template literal (`import { $ } from "bun"`) |

## Build & Test Commands

All commands are run from the repo root.

```bash
# Install dependencies
bun install

# Run the full test suite (unit + smoke; default 5s per-test timeout)
bun test

# Fast unit-only gate (~90ms at --timeout 100)
bun run test:fast
bun run check:fast       # format + lint + typecheck + test:fast

# Preview CI gates without running them
bun run check:dry-run    # accepts --dryrun alias (gate steps only)
# CI test profile (60s timeout, coverage, lcov, junit, --bail)
bun run test:coverage:ci
bun run format:check:ci   # oxfmt --threads=4 for CI runners

# Full quality gate (CI / pre-push)
bun run check            # scripts/check.ts

# TypeScript type check (no emit)
bun run typecheck        # tsc --noEmit

# Format and lint (oxfmt / oxlint)
bun run format           # oxfmt --write .
bun run format:check     # oxfmt --check .
bun run lint             # oxlint src test scripts

# Run individual tools from source
bun run src/bin/kimi-doctor.ts --quick
bun run src/bin/kimi-governance.ts score
bun run src/bin/kimi-guardian.ts check

# Convenience wrappers (defined in package.json scripts)
bun run doctor           # = bun run src/bin/kimi-doctor.ts
bun run fix              # = bun run src/bin/kimi-fix.ts
bun run governance       # = bun run src/bin/kimi-governance.ts

# Sync repo → ~/.kimi-code/
bun run sync             # one-shot
bun run sync:daemon      # Bun.cron every 5 minutes
```

### Global Install (for end users)

```bash
bun install -g github:brendadeeznuts1111/kimi-toolchain
```

After global install, all `kimi-*` binaries are available on PATH.

## Code Organization

### CLI Tools (`src/bin/`)

Each tool is a self-contained Bun script with a `#!/usr/bin/env bun` shebang. They share:

- `../lib/utils.ts` — `ensureDir`, `log`, `sha256File`, `runTool`, `resolveProjectRoot`, `getProjectName`, `safeParse`, etc.
- `../lib/version.ts` — `TOOLCHAIN_VERSION`, `getDesktopVersion()`, `getRepoHead()`, etc.

Every tool supports at minimum:

- A `doctor` subcommand — health check returning structured `{ name, status, message, fixable }` checks.
- A `fix` subcommand — auto-repair where applicable.

### Shared Library (`src/lib/`)

- **`utils.ts`** — Zero-dependency helpers. Key exports:
  - `runTool(toolName, args, options)` — executes another kimi tool via `~/.kimi-code/tools/`
  - `recordDoctorRun(project, tool, warnings, rScore?, gitHead?)` — persists warnings to `sessions.db`
  - `getPersistentWarnings(tool?)` — reads warning trends from `sessions.db`
  - `DoctorCheck` / `DoctorReport` interfaces — standard diagnostic shape
- **`version.ts`** — Single source of truth for version. Derives from `package.json` at runtime, falls back to `~/.kimi-code/toolchain-manifest.json`.

### Hooks (`src/hooks/`)

- **`postinstall.ts`** — Creates `~/.kimi-code/` directory tree, copies tools/lib/templates, initializes `sessions.db` schema, installs the agent skill to `~/.agents/skills/kimi-toolchain/`.

## Testing Strategy

- **Test runner**: `bun:test` (built into Bun)
- **Test file**: `test/kimi-doctor.smoke.test.ts`
- **Test style**: Smoke tests — spawn each CLI tool as a subprocess and assert on stdout + exit code.
- **Isolation**: Tests use a temporary `HOME` directory so they never touch the real `~/.kimi-code/`.
- **Timeout**: Default 30s per test; 120s for the full `kimi-doctor` run (which invokes all sub-doctors).
- **Coverage**: Run `bun test --coverage`.

### Running tests

```bash
bun test                 # all tests
bun test --coverage      # with coverage report
bun run typecheck        # TypeScript validation
```

## Development Conventions

### Formatting & lint

- **Formatter:** [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) — config in `.oxfmtrc.json`
- **Linter:** [oxlint](https://oxc.rs/docs/guide/usage/linter.html) — config in `.oxlintrc.json`
- **Banned terms:** `scripts/lint-banned-terms.ts` — blocks internal branding tags in docs; runs via `bun run lint`
- Run `bun run format` before commit; CI uses `format:check`, `lint`, and `typecheck`
- Composite gate: `bun run check` (= format:check + lint + typecheck + test)
- Cursor: `oxc.oxc-vscode` extension as default formatter for TS/JS (format on save)

### Quality gates (enforced)

| Layer      | Command / hook                                                      |
| ---------- | ------------------------------------------------------------------- |
| Local      | `bun run check` or `bun run unify`                                  |
| pre-commit | `format:check` + `lint` + `typecheck` (via `kimi-githooks install`) |
| pre-push   | `check` script + guardian + R-Score gate                            |
| CI         | `.github/workflows/ci.yml` — format:check, lint, typecheck, test    |
| Doctor     | `kimi-doctor` Code Quality section (runs gates unless `--quick`)    |

Install hooks: `kimi-githooks install` or `kimi-githooks fix` to refresh outdated hooks.

### Bun-Native Coding Standards

The project follows strict Bun-native conventions. **Always prefer Bun APIs over Node equivalents.**

| Task          | Use                                  | Avoid                                 |
| ------------- | ------------------------------------ | ------------------------------------- |
| Read file     | `Bun.file(path).text()` / `.json()`  | `fs.readFileSync`                     |
| Write file    | `Bun.write(path, data)`              | `fs.writeFileSync`                    |
| Hash          | `new Bun.CryptoHasher("sha256")`     | `crypto.createHash`                   |
| Spawn         | `Bun.spawn(cmd, { stdout: "pipe" })` | `child_process.spawn`                 |
| Sleep         | `await Bun.sleep(ms)`                | `new Promise(r => setTimeout(r, ms))` |
| Glob          | `new Bun.Glob(pattern)`              | `fs.readdir` + regex                  |
| TOML          | `Bun.TOML.parse(text)`               | `@iarna/toml`                         |
| Semver        | `Bun.semver.satisfies(v, range)`     | `semver` package                      |
| Stdout        | `Bun.stdout.write(data)`             | `process.stdout.write`                |
| Stream → text | `Bun.readableStreamToText(stream)`   | `new Response(stream).text()`         |

- Use `Uint8Array` instead of `Buffer` for binary data.
- Use `Bun.file(path).lastModified` for mtime, not `fs.stat()`.
- Prefer `for await...of` over `.on("data", ...)` for stream consumption.
- Use `await proc.exited` to get exit code from `Bun.spawn`. Do not read `proc.exitCode` before the process finishes.

### Process & Signal Handling

- `process.on("SIGINT", handler)` is acceptable.
- `process.exit(code)` is acceptable for CLI tools.
- For resource-limited spawning, use `governedSpawn()` from `kimi-resource-governor.ts`.

### Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or correcting tests
- `chore:` — maintenance tasks

## Quality Gates (R-Score)

The project uses its own `kimi-governance score` system. The R-Score formula checks:

| Check           | Weight    |
| --------------- | --------- |
| hasLicense      | 10        |
| hasContributing | 10        |
| hasCodeowners   | 10        |
| hasReadme       | 10        |
| hasContext      | 10        |
| hasChangelog    | 5 (bonus) |
| testCoverage    | 25        |
| docsFresh       | 15        |
| noStaleLockfile | 10        |

Grades: A (≥90%), B (≥80%), C (≥70%), D (≥60%), F (<60%). CLI shows points, max (110), and decimal % (e.g. `C (87.3/110, 79.4%)`). Coverage points are fractional, not rounded.

**Pre-push hooks block push if R-Score is F or D.**

## Security Considerations

- **No secrets in source.** Use `Bun.env` or `Bun.secrets`.
- **Pre-commit hook** blocks `.env` files from being committed.
- **Guardian** baselines `bun.lock` hashes and signs manifests with HMAC (key stored in macOS Keychain or `~/.kimi-code/guardian/.key` with `chmod 600`).
- **CVE scanning** uses the OSV API (`api.osv.dev`) for outdated dependencies.
- **Trusted dependencies** gate: packages with `postinstall`/`preinstall`/`install` scripts must be listed in `bunfig.toml`'s `trustedDependencies`.
- Validate all external input at system boundaries.

## Memory Budget (16 GB)

On memory-constrained hosts, swap thrashing inflates load average and disk I/O before CPU looks busy. Prevent it:

| Rule                                                                                                  | Why                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Do **not** run Chrome + Kimi Desktop + kimi CLI + cursor-agent concurrently                           | Chrome alone can use ~5 GB                  |
| **No Docker** on this machine — use Bun-native dev (`dx.config.toml` `[runtime].containers = "none"`) | Docker VM was ~600MB idle overhead          |
| Run `bun run memory-check` or `kimi-doctor --quick` before long agent sessions                        | Catches low RAM / high swap early           |
| Run `kimi-doctor --memory-budget` to see per-app RSS                                                  | Same breakdown as investigation tooling     |
| Use **kimi CLI OR Kimi Desktop**, not both                                                            | Duplicate Electron/Node stacks              |
| Never run `bun run sync:daemon` unless developing toolchain                                           | Background Bun cron every 5 min             |
| Run `kimi-orphan-kill --dry-run` weekly                                                               | Cleans stale `bun test` / kimi-tool orphans |

**Governor config:** `~/.kimi-code/governor/defaults.toml` — `maxParallelJobs` caps at 2 when free RAM < 2 GB.

**Monitoring scripts:**

- `scripts/memory-check.sh` — pre-session gate (`bun run memory-check`)
- `scripts/memory-baseline.sh` — before/after metrics snapshot

## Deployment / Distribution

- **No build step.** TypeScript is run directly via `bun run`.
- **Distribution**: GitHub repo, installed via `bun install -g github:brendadeeznuts1111/kimi-toolchain`.
- **Live runtime**: `~/.kimi-code/` is maintained by `postinstall.ts` and `sync-to-desktop.ts`.
- **Files included in package**: `src/`, `skills/`, `AGENTS.md`, `UNIFIED.md`, `TEMPLATES.md`, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `CHANGELOG.md`.

## Key Files for Agents

| File                             | Purpose                                        |
| -------------------------------- | ---------------------------------------------- |
| `package.json`                   | Toolchain metadata, bin mappings, scripts      |
| `tsconfig.json`                  | Strict TypeScript, ESNext, bundler resolution  |
| `bunfig.toml`                    | Bun install config (`saveTextLockfile = true`) |
| `src/lib/utils.ts`               | Shared utilities — import from here            |
| `src/lib/version.ts`             | Version resolution logic                       |
| `src/lib/memory-budget.ts`       | System memory / RSS budget checks              |
| `src/lib/governor-config.ts`     | Loads `~/.kimi-code/governor/defaults.toml`    |
| `src/lib/test-gates.ts`          | Unit vs smoke test lists, `bunTestArgs()`      |
| `scripts/check.ts`               | CI gate runner with dry-run and fast modes     |
| `test/kimi-doctor.smoke.test.ts` | Smoke tests for all tools                      |
| `CONTEXT.md`                     | Auto-generated project context                 |
| `skills/kimi-toolchain/SKILL.md` | Agent decision protocol                        |

## Quick Reference: All CLI Tools

| Tool                     | Key Commands                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `kimi-doctor`            | `doctor`, `doctor --fix`, `doctor --quick`, `doctor --memory-budget`                                              |
| `kimi-orphan-kill`       | `--dry-run` (cleanup stale test/tool processes)                                                                   |
| `kimi-fix`               | `fix <path>`, `fix <path> --dry-run`                                                                              |
| `kimi-governance`        | `score`, `fix`, `coverage [N]`, `docs`, `adr <title>`, `doctor`                                                   |
| `kimi-guardian`          | `check`, `sign`, `verify`, `report`, `fix`, `doctor`                                                              |
| `kimi-memory`            | `store`, `recall`, `resume`, `autosave`, `graph`, `impact`, `search`, `prune`, `stats`, `trends`, `doctor`, `fix` |
| `kimi-githooks`          | `install`, `doctor`, `fix`                                                                                        |
| `kimi-context-gen`       | `scan`, `update`, `freshness`, `doctor`, `fix [threshold]`                                                        |
| `kimi-release`           | `changelog`, `semver`, `validate`, `doctor`, `fix`                                                                |
| `kimi-debug`             | `last`, `diff`, `trace`, `analyze`, `doctor`, `fix`                                                               |
| `kimi-snapshot`          | `save`, `restore`, `list`, `show`, `cleanup`, `doctor`, `fix`                                                     |
| `kimi-resource-governor` | `limits`, `parallel`, `quota`, `cache`, `spawn`, `session`, `cleanup`, `status`, `doctor`, `fix`                  |

---

_Generated from project source. Update when adding new tools or changing conventions._
