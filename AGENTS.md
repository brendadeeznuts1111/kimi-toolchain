# kimi-toolchain — Agent Guide

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding.
> This file is for AI coding agents. It assumes zero prior knowledge of the project.
> Last refreshed from `package.json`, `bunfig.toml`, `dx.config.toml`, `CODE_REFERENCES.md`, `UNIFIED.md`, `README.md`, `test/testing.md`, `src/lib/README.md`, and the live source tree.

## Workspace setup (read first)

| Rule                     | Value                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| **Canonical clone path** | `~/kimi-toolchain`                                                                         |
| **Folder name**          | Must be `kimi-toolchain` (matches `package.json` `name`)                                   |
| **Primary entry**        | `kimi-toolchain <tool> [args]` or `bun run <script>` from the repo root                    |
| **Repo root**            | Use `git rev-parse --show-toplevel` or the workspace root — never assume an old clone path |

**Cursor / editor worktrees:** Cursor sometimes opens a git worktree under a temp path (`wt-match`, `.codex/worktrees`, `.grok/worktrees`, `herdr-worktrees`) where `git rev-parse --show-toplevel` points at the worktree but `package.json` is not materialized. In that case Grep/Glob and `bun run` from the editor cwd will fail.

- **Preferred fix:** File → Open Folder → `~/kimi-toolchain` (canonical clone).
- **Automatic fallback:** `bun run unify`, `bun run verify-workspace`, and `kimi-toolchain workspace *` resolve via `scripts/resolve-repo-root.sh` / `resolveEffectiveWorkspaceRoot()` and fall back to `~/kimi-toolchain` when the worktree lacks `package.json`. A stderr warning is emitted when fallback is used.
- **Agents:** If tools cannot find repo files, run `pwd` and `git rev-parse --show-toplevel`; when they differ from `~/kimi-toolchain` and `package.json` is missing at the git root, operate from `~/kimi-toolchain` or rely on the fallback (set `KIMI_PROJECT_ROOT` after `bun run unify`).

**After reopen checklist:**

1. `pwd` ends with `kimi-toolchain`.
2. `kimi-toolchain workspace verify` (or `bun run verify-workspace`).
3. `kimi-toolchain workspace cleanup` — audit legacy Cursor slugs (no delete by default).
4. If slug persists: `kimi-toolchain workspace fix --deep`, then quit Cursor fully and reopen `kimi-toolchain.code-workspace`.
5. Full cross-product check: `kimi-toolchain doctor --ecosystem --quick --json`.

## Project overview

`kimi-toolchain` is a Bun-native CLI toolkit that provides project health checks, supply-chain security, governance scoring, session memory, git hooks, and scaffolding automation. It is a meta-project: the tools manage other projects.

- **Repository:** `https://github.com/brendadeeznuts1111/kimi-toolchain`
- **License:** MIT
- **Author:** nolarose
- **Language:** TypeScript (ESNext, strict mode)
- **Runtime:** Bun >= 1.3.14 (recommended >= 1.4.0)
- **Package manager:** `bun pm`
- **Minimal runtime dependencies:** `effect`, `js-yaml`; everything else uses Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.spawn`, etc.)

**Naming boundaries (do not conflate):**

| Layer                  | Product                                           | Canonical path                                   |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Agent**              | **Kimi Code** (`kimi`) — Moonshot Node SEA binary | `~/.kimi-code/bin/kimi`                          |
| **Toolchain**          | **kimi-toolchain** (this repo)                    | `~/kimi-toolchain/`                              |
| **Runtime extensions** | Synced tools/lib/governor/skills                  | `~/.kimi-code/tools/`, `~/.kimi-code/lib/`, etc. |
| **Global platform**    | **dx**                                            | `~/.config/dx/`, `~/.local/bin/dx`               |

- `kimi doctor` — official Kimi Code config check (not `kimi-doctor`).
- `kimi-doctor` — this repo's Bun diagnostics aggregator.
- Kimi Code config, MCP, sessions, slash commands: see `skills/kimi-toolchain/SKILL.md`.
- One-shot setup: `bash scripts/unify.sh`.

## Key configuration files

| File                         | Purpose                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`               | Project metadata, `bin` map (26 registered CLI tools), npm scripts, dependencies (`effect`, `js-yaml`), `trustedDependencies` policy, devDependencies (`@types/bun`, `oxfmt`, `oxlint`, `ts-morph`, `typescript`) |
| `bunfig.toml`                | Bun install policy (`[install]`), test defaults (`[test]`), and build-time define constants (`[define]`)                                                                                                          |
| `tsconfig.json`              | TypeScript strict, ESNext, bundler resolution, `noEmit`, includes `src/`, `test/`, `scripts/`, `types/*.d.ts`                                                                                                     |
| `dx.config.toml`             | Project DX policy: runtime (`containers = "none"`), quality gate script aliases, `[finishWork]` gates, `[herdr]` orchestration layout, `[cloudflare]` read-only mode, `[[endpoints]]` inventory                   |
| `.oxfmtrc.json`              | `oxfmt` formatter config (printWidth 100, 2-space tabs, trailing commas `es5`, ignore patterns)                                                                                                                   |
| `.oxlintrc.json`             | `oxlint` linter config (plugins `typescript`, `unicorn`, `oxc`; category `correctness` = error)                                                                                                                   |
| `error-taxonomy.yml`         | Failure classification schema used by `kimi-error`, `kimi-debug`, `kimi-heal`, and the failure ledger                                                                                                             |
| `canonical-references.json`  | Ecosystem doc links (Bun, Effect, Kimi Code, Herdr, Cloudflare, DX) generated by `bun run references:generate`                                                                                                    |
| `trusted-keys.json`          | Ed25519 public keys for contract signature verification                                                                                                                                                           |
| `types/build-constants.d.ts` | Type declarations for `bunfig.toml` `[define]` globals                                                                                                                                                            |

## Technology stack

| Layer            | Choice                                                 |
| ---------------- | ------------------------------------------------------ |
| Runtime          | Bun >= 1.4.0                                           |
| Language         | TypeScript (strict, ESNext, bundler resolution)        |
| Test runner      | `bun:test` (Bun's built-in test runner)                |
| Database         | SQLite via `bun:sqlite` (WAL mode)                     |
| Config           | `bunfig.toml` (Bun-native TOML)                        |
| Package manager  | `bun pm`                                               |
| Shell            | Bun's `$` template literal (`import { $ } from "bun"`) |
| Formatter        | `oxfmt`                                                |
| Linter           | `oxlint`                                               |
| Effect framework | `effect` (used for typed CLI/runner pipelines)         |

**Prefer Bun APIs over Node equivalents.** Always use `Bun.file`, `Bun.write`, `new Bun.CryptoHasher("sha256")`, `Bun.spawn`, `await Bun.sleep(ms)`, `new Bun.Glob(...)`, `Bun.TOML.parse(...)`, `Bun.readableStreamToText(...)`. Use `Uint8Array` instead of `Buffer`. See `CODE_REFERENCES.md` for the full Bun-native exemplar map.

## Architecture & code organization

### Top-level directories

| Directory            | Contents                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/bin/`           | CLI tools (`kimi-doctor.ts`, `kimi-governance.ts`, `kimi-fix.ts`, `herdr-*.ts`, etc.). Registered tools are listed in `package.json` `bin`; several are source-only and must be run via `bun run src/bin/<tool>.ts` or the `kimi-toolchain` router. |
| `src/lib/`           | Shared library modules. Flat by default to avoid deep imports and circular dependencies. `src/lib/effect/` is the intentional exception for Effect adapters. See `src/lib/README.md` for the domain map.                                            |
| `src/install-hooks/` | `postinstall.ts` — Bun package hook that idempotently sets up `~/.kimi-code/`.                                                                                                                                                                      |
| `src/kimi-hooks/`    | Kimi Code lifecycle hooks (e.g., `log-tool-failure.ts`) that are declared in `~/.kimi-code/config.toml` `[[hooks]]`.                                                                                                                                |
| `src/gates/`         | Built-in execution gates (`bunfig-policy`, `perf-gate`, `tls-compliance`, `card-probe`, `strategy-performance`, `model-drift`).                                                                                                                     |
| `src/harness/`       | Effect benchmark harness handlers and perf monitors.                                                                                                                                                                                                |
| `test/`              | Unit, integration, smoke, DB tests, helpers, and fixtures. See `test/testing.md`.                                                                                                                                                                   |
| `scripts/`           | Quality gate runners, lint sub-scripts, sync scripts, and CI helpers.                                                                                                                                                                               |
| `skills/`            | Agent skill files (synced to `~/.agents/skills/` and `~/.kimi-code/skills/`).                                                                                                                                                                       |
| `templates/`         | Scaffold templates (`templates/scaffold/`, `templates/bun-create/`, `templates/modules/`). See `TEMPLATES.md`.                                                                                                                                      |
| `docs/`              | ADRs, references, canvases, and handoff rules.                                                                                                                                                                                                      |
| `contracts/`         | JSON contract samples and `artifact-portal.json`.                                                                                                                                                                                                   |
| `bench/`             | Benchmarks (`core.bench.ts`).                                                                                                                                                                                                                       |

### `src/lib/` domains (summary)

| Domain         | Representative files                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Core**       | `utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`, `health-check.ts`, `logger.ts`                              |
| **Effect**     | `effect/errors.ts`, `effect/cli-runtime.ts`, `effect/tool-runner-effect.ts`, `effect/cli-contract-effect.ts`        |
| **Governance** | `r-score.ts`, `governance-check.ts`, `governance.ts`, `readme-sync.ts`                                              |
| **Scaffold**   | `scaffold-templates.ts`, `scaffold-agents.ts`, `scaffold-doctor.ts`, `scaffold-quality.ts`                          |
| **Cloudflare** | `cloudflare-access.ts`, `cloudflare-access-policy.ts`                                                               |
| **Governor**   | `governor-*.ts` (resource limits, parallelism, disk quota, diagnostic cache)                                        |
| **Memory**     | `memory-budget.ts`, `memory-sessions.ts`, `sessions-schema.ts`                                                      |
| **Git**        | `git-helpers.ts`, `conventional-commits.ts`, `changelog.ts`                                                         |
| **Config**     | `mcp-config.ts`, `kimi-config-audit.ts`, `test-gates.ts`, `test-runtime.ts`, `testing-docs-lint.ts`, `artifacts.ts` |
| **Health**     | `workspace-health.ts`, `workspace-commands.ts`, `legacy-cleanup.ts`, `ecosystem-health.ts`                          |
| **Doctor**     | `doctor-runs.ts`, `doctor-pipeline.ts`, `doctor-adapters/`, `doctor-adapter-types.ts`                               |
| **Sync**       | `desktop-sync.ts`, `sync-hashes.ts`, `sync-manifest.ts`                                                             |
| **Taxonomy**   | `error-taxonomy.ts`                                                                                                 |

### Three hook systems (do not conflate)

| System                        | Location                                                                      | Purpose                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Git hooks**                 | `.git/hooks/` (installed by `kimi-githooks`)                                  | `pre-commit` (format/lint/typecheck), `pre-push` (guardian + R-Score + sync + sync verify) |
| **Bun install hook**          | `src/install-hooks/postinstall.ts`                                            | Idempotent `~/.kimi-code/` setup after `bun install`                                       |
| **Kimi Code lifecycle hooks** | `src/kimi-hooks/` scripts; declared in `~/.kimi-code/config.toml` `[[hooks]]` | Intercept `PreToolUse`, audit `PostToolUseFailure`, notifications, etc.                    |

### Live runtime (`~/.kimi-code/`)

`postinstall.ts` copies sources to `~/.kimi-code/` (`tools/`, `lib/`, `scripts/`, `mcp.json`, `skills/`, `var/`, `guardian/`, `governor/`, synced docs). It also initializes `~/.kimi-code/var/sessions.db` (SQLite WAL) and writes `~/.kimi-code/toolchain-manifest.json` with sha256 hashes.

**Do not edit `~/.kimi-code/` manually.** Use `bun run sync` (or `bun run sync:daemon`) to push repo changes to the live runtime, and `bun run sync:verify` to check hashes.

## Build, test & quality gates

**There is no build step.** TypeScript is run directly via `bun run`.

### Common commands

```bash
bun install

# Fast iteration (~3s): format + lint + typecheck + UNIT_TEST_FILES
bun run check:fast
bun run test:fast

# Full gate (CI / pre-push): format:check + lint + typecheck + all tests
bun run check

# Preview gate steps without running them
bun run check:dry-run

# Branch-scoped iterate: only changed files vs main
bun run check:fast:changed

# TDD loops (debounced file watcher)
bun run check:watch
bun run check:watch:tests

# TypeScript (no emit)
bun run typecheck

# Format / lint
bun run format           # oxfmt --write .
bun run format:check     # oxfmt --check .
bun run lint             # many sub-lints (see below)

# Targeted test
bun test test/lib.unit.test.ts
bun test --coverage

# Run tools from source
bun run doctor           # = src/bin/kimi-doctor.ts
bun run governance       # = src/bin/kimi-governance.ts

# Sync repo → ~/.kimi-code/
bun run sync && bun run sync:verify

# Global install (end users)
bun install -g github:brendadeeznuts1111/kimi-toolchain
```

### `bun run check` pipeline (`scripts/check.ts`)

1. `kimi-doctor --success-metrics` (silent on success).
2. `format:check` (`oxfmt --check`).
3. `lint` (full in CI; `--names-only` in `--fast` mode).
4. `typecheck` (`tsc --noEmit`).
5. `test` (full) or `test:fast` (unit tier).

Use `--dry-run` to list steps, `--fast` for the unit tier, `--skip-tests` to omit tests.

### `bun run lint` pipeline (`scripts/lint.ts`)

Full mode runs: `oxlint src test scripts`, banned-terms, bun-native, context-bloat, skill-coverage, skill-frontmatter, tochange, test-names, build-constants, constants-manifest parity, canonical-references parity, cursor-canvas, canvas-influences, examples-showcase, doc-links, testing-docs, markdown-links, constant-parity, cli-contract, defaults-consts, and `dx:table:contract`.

Use `--files <paths...>` for scoped lint (oxlint + banned-terms + patterns + test-names + doc-links). Use `--names-only` to skip heavier convention/contract/default-consts debt checks.

### Gate layers

| Layer      | Command / hook                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Local      | `bun run check` or `bun run unify`                                                                                           |
| pre-commit | `format:check` + `lint` + `typecheck` (via `kimi-githooks install`)                                                          |
| pre-push   | `check:fast` + guardian + effect-gates + constant-drift + R-Score (preflight auto-fix via `--hook`) + mandatory runtime sync |
| Local CI   | `bun run ci:local` — format:check, lint, typecheck, test, coverage, effect-gates, governance                                 |
| Doctor     | `kimi-doctor` Code Quality section (runs gates unless `--quick`)                                                             |

**Escape hatches:** `KIMI_SKIP_EFFECT_GATES=1` bypasses the Effect-discipline gate; `KIMI_SKIP_GOVERNANCE_PREFLIGHT=1` skips lock/README/guardian auto-fix before R-Score. Use only in emergencies and document the bypass in the commit message.

### R-Score & governance preflight

`kimi-governance score` checks license, CONTRIBUTING, CODEOWNERS, README, CONTEXT, changelog (bonus), test coverage, docs freshness, and lockfile staleness. Grades: A (≥90%), B (≥80%), C (≥70%), D (≥60%), F (<60%). Pre-push blocks D and F.

Governance preflight (`src/lib/governance-preflight.ts`) auto-fixes:

| Action               | When                                       |
| -------------------- | ------------------------------------------ |
| `lockfile_refreshed` | `package.json` mtime newer than `bun.lock` |
| `readme_patched`     | README missing `package.json` scripts      |
| `guardian_baselined` | Guardian hash missing or mismatched        |

```bash
kimi-governance score --preflight --quick   # manual pre-push check
bun run finish-work --message "..." --push  # gates + commit + push close-loop
```

### Success metrics

Run `kimi-doctor --success-metrics` for a pass/fail view.

| Metric                  | Required default                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drift latency**       | Documented commands, samples, and help examples must be checkable in one `kimi doctor` or `kimi-doctor` run without manual inspection.        |
| **Error coverage**      | ≥ 90% of managed contract, hook, and integration failures must get a taxonomy code plus structured stack, input, and environment context.     |
| **Integration agility** | New cloud providers are represented by only two artifacts: a contract declaration and a thin `getSecret(scope) -> string` credential adapter. |

These metrics are not frozen. Threshold changes follow the toolchain release cadence and must include failure ledger evidence.

## Agent Introspection

Before deeper debugging, prefer structured probes:

```bash
kimi-capabilities --json
kimi-trace <trace-id> --json
kimi-contract validate --json
kimi-why <topic> --json
```

Use `KimiIntrospectionLive` for Effect-native capability, trace, and contract checks. Self-healing flows are implemented in `src/lib/self-healing.ts`; inspect that path before changing `kimi-heal` behavior.

## Testing strategy

- **SSOT:** `src/lib/test-runtime.ts` — Bun contracts (`BUN_TEST_*`, `KIMI_*`); tier runners; verified by `test/test-runtime.unit.test.ts`.
- **File lists:** `src/lib/test-gates.ts` — `UNIT_TEST_FILES`, `INTEGRATION_TEST_FILES`, `SMOKE_TEST_FILES`.
- **Author guide:** `test/testing.md` — naming, isolation, grouping, anti-patterns, doc audit recipes.
- **Test runner:** `bun:test` via `bun run test:fast` (unit tier) or `bun run test` (all tiers).
- **Preload:** `bunfig.toml` `[test].preload = ["./test/setup.ts"]`.
- **Isolation:** `test/setup.ts` sets `KIMI_TEST_HOME`; use `withIsolatedHome()` / `withEnv()` from `test/helpers.ts`.

### Test tiers

| Tier        | Command                    | Files                                        | Timeout                       |
| ----------- | -------------------------- | -------------------------------------------- | ----------------------------- |
| Unit (fast) | `bun run test:fast`        | `UNIT_TEST_FILES` in `src/lib/test-gates.ts` | 30 s (`FAST_TEST_TIMEOUT_MS`) |
| Integration | `bun run test:integration` | `INTEGRATION_TEST_FILES`                     | 30 s                          |
| Smoke       | `bun run test:smoke`       | `test/smoke/*.smoke.test.ts`                 | 60 s                          |
| All         | `bun run test`             | unit → integration → smoke                   | per tier                      |

Pre-push runs `check:fast` by default. Set `KIMI_PRE_PUSH_FULL=1` when the full gate bundle is required before pushing.

### File naming

Enforced by `scripts/lint-test-names.ts`:

| Pattern                      | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `{stem}.unit.test.ts`        | Fast gate; maps to a source module under `src/`        |
| `{stem}.integration.test.ts` | Full suite only                                        |
| `{stem}.smoke.test.ts`       | CLI smoke (`test/smoke/`)                              |
| `{stem}.db.test.ts`          | Sequential DB tests (excluded from fast parallel glob) |

Top-level `describe("…")` must use **kebab-case** and start with the file stem.

### Testing do's and don'ts

- Import test symbols explicitly from `"bun:test"` (`test`, `describe`, `expect`, `mock`).
- Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`) over Node sync I/O.
- Do **not** import `readFileSync` / `writeFileSync` / `mkdtempSync` from `node:fs`.
- Do **not** assign `process.env.*` without restoration; use `withEnv()` / `withClearedEnv()`.
- Do **not** assign `console.log = …`; use `captureConsole()` / `captureStderrWrite()`.
- Use `testTempDir()` / `withTempDir()`; cleanup with `cleanupPath()` in `finally`.
- Smoke tests invoke tools via `invokeTool()` wrappers, not ad-hoc `Bun.spawn(["bun", "run", …])`.
- Avoid bare `bun test` in hooks/CI; use tier scripts.

## Code style guidelines

### Imports

- Use **relative imports** from `src/lib/` or `src/effect/`: `import { ... } from "../lib/utils.ts"`.
- Never use absolute paths or path aliases.
- The `core/` files (`utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`) are imported by almost everything — keep them lightweight and dependency-free.

### Path helpers

All paths under `~/.kimi-code/` must use `src/lib/paths.ts` helpers (`homeDir`, `desktopRoot`, `toolsDir`, `libDir`, `varDir`, `guardianDir`, `governorDir`, `memoryDir`, `skillsDir`, `mcpPath`, `configTomlPath`, `manifestPath`, etc.). **Never hardcode `~/.kimi-code` strings in source.**

### Safe parsing

Use `safeParse<T>()` and `safeToml<T>()` from `src/lib/utils.ts` instead of unchecked `JSON.parse` / `TOML.parse` casts.

### Build-time constants

Three layers must stay separate:

| Layer               | Purpose                             | Format                                      | Where                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| **define constant** | Immutable compile-time tuning       | `KIMI_{DOMAIN}_{QUALIFIER}` SCREAMING_SNAKE | `bunfig.toml` `[define]`, `types/build-constants.d.ts` |
| **defineDomain**    | Group constants by functional slice | kebab-case, matches lib module              | `# define-domain:…` in bunfig, `@defineDomain` JSDoc   |
| **taxonomyId**      | Classify tool/runtime **failures**  | snake*case `{domain}*{reason}`              | `error-taxonomy.yml`, failure JSONL                    |

Rules:

1. Every `[define]` key starts with `KIMI_`.
2. Booleans end with `_ENABLED` (`KIMI_CONTRACT_INFERENCE_ENABLED`), never `ENABLE_*`.
3. Paths/versions include domain: `KIMI_CONTRACT_OBSERVATIONS_PATH`, `KIMI_CONTRACT_SCHEMA_VERSION`.
4. Change tuning values only in `bunfig.toml`; extend `types/build-constants.d.ts` when adding a constant.
5. Regenerate and verify the manifest with `bun run manifest:generate`.
6. `bun run lint` enforces constant naming and parity.

### CLI tools

Each tool in `src/bin/` is a self-contained Bun script with a `#!/usr/bin/env bun` shebang. They share `../lib/utils.ts` and `../lib/version.ts`. Every tool supports at minimum a `doctor` subcommand and a `fix` subcommand where applicable.

Use the established runners:

| Need                            | Use                                                    | Avoid                                                |
| ------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Invoke another toolchain CLI    | `invokeTool()` / `runTool()` from `tool-runner.ts`     | Raw `Bun.spawn(["bun", "run", ...])` in feature code |
| Invoke from Effect code         | `invokeToolEffect()` / `runToolEffect()`               | Converting every error to an untyped string          |
| Parse common CLI flags          | `createCli(Bun.argv, toolName)` from `cli-contract.ts` | Ad-hoc `Bun.argv.includes("--json")`                 |
| Emit structured health results  | `logger.check()` / `logger.printHealthReport()`        | Ad hoc JSON shapes                                   |
| Long or noisy subprocess output | `maxOutputBytes` on `invokeTool()`                     | Unbounded stream capture                             |

### Effect discipline

Use Effect when a CLI path needs typed failures, telemetry-safe cleanup, or parallel orchestration.

- Wrap CLI mains in `runCliExit()` from `src/lib/effect/cli-runtime.ts`.
- Use tagged errors from `src/lib/effect/errors.ts` (`Data.TaggedError`).
- Preserve taxonomy fields (`taxonomyId`, `suggestion`, `autoFix`) when converting subprocess results.
- Do not mix `process.exit()` throughout business logic.
- Do not add `Effect` to simple pure helpers.

When touching Effect code, run Effect gates before committing:

```bash
kimi-doctor --effect-gates
kimi-heal effect audit --check-tags --event-streams --json
```

Full contract: `DEEP-QUALITY.md`.

### Commit convention

Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Security considerations

- **No secrets in source.** Use `Bun.env` or `Bun.secrets`.
- **Pre-commit hook** blocks `.env` files from being committed.
- **Guardian** baselines `bun.lock` hashes and signs manifests with HMAC (key in macOS Keychain or `~/.kimi-code/guardian/.key` with `chmod 600`).
- **CVE scanning** uses the OSV API (`api.osv.dev`).
- **Trusted dependencies** gate: dependency lifecycle scripts must be listed in `package.json` `trustedDependencies` (Bun SSOT). `kimi-guardian check` audits; `kimi-guardian fix` or `bun pm trust <pkg>` adds entries.
- Secure install policy lives in `bunfig.toml` `[install]`: `frozenLockfile`, `linker = "isolated"`, `minimumReleaseAge`, `globalDir` / `globalBinDir` for `bun install -g`.
- CLI SSOT for install commands: `BUN_INSTALL_CLI` in `src/lib/bun-install-config.ts` (`bun ci`, `bun add <pkg>`, `bun update <pkg>`, `kimi-guardian fix`).
- Validate all external input at system boundaries.

### Cloudflare API token setup

`kimi-cloudflare-access` reads credentials from `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` env vars, or from the OS keychain via `kimi-cloudflare-access login`. Required token permissions:

| Permission             | Commands                      |
| ---------------------- | ----------------------------- |
| Account > Access: Read | `tokens`, `apps`, `doctor`    |
| Account > Access: Edit | `fix` (rotate service tokens) |

Cloudflare MCP SSO/OAuth, Wrangler OAuth, and `kimi-cloudflare-access` API tokens are separate auth paths — do not assume one login satisfies another.

## Deployment & distribution

- **No build step.** TypeScript is run directly via `bun run`.
- **Distribution:** GitHub repo, `bun install -g github:brendadeeznuts1111/kimi-toolchain`.
- **Live runtime:** `~/.kimi-code/` maintained by `postinstall.ts` and `scripts/sync-to-desktop.ts`; sync writes `toolchain-manifest.json` with file hashes.
- **Global PATH wrappers:** `scripts/install-bin-wrappers.sh` installs `~/.local/bin/kimi-*` stubs pointing at `~/.kimi-code/tools/*.ts`.

When tools, docs, skills, templates, or generated runtime assets change, final handoff validation must include:

```bash
bun run sync && bun run sync:verify
```

## Agent workflow & conventions

### Before a long session

```bash
kimi-doctor --agent-ready
kimi-doctor --quick
kimi-orphan-kill --dry-run   # if needed
kimi-governance score --preflight --quick
```

### During iteration (step-budget discipline)

| Instead of                             | Use                                          |
| -------------------------------------- | -------------------------------------------- |
| `bun run test` (full suite, ~15s)      | `bun run test:fast` (`UNIT_TEST_FILES`, ~5s) |
| `bun run check` (~30s)                 | `bun run check:fast` (~3s)                   |
| Re-running full suite after every edit | `bun test <specific-file>`                   |
| `kimi-doctor` without `--quick`        | `kimi-doctor --quick`                        |

Batch edits (5–8 files) → `bun run check:fast` → fix failures → repeat → `bun run check` before commit.

### Agent Operating Loop

1. **Scope** — read `CODE_REFERENCES.md`, pick the closest existing pattern, and name the smallest change slice.
2. **Implement** — keep parsing, mutation, subprocess, and telemetry boundaries typed and local to established modules.
3. **Guard** — do not leave root-cause fixes as one-off patches; add a detector, regression test, or stale-pattern scan.
4. **Validate** — run targeted tests first (`bun test <specific-file>`), then `bun run check:fast`; reserve full checks for handoff.

### Regression hygiene

After fixing a root cause: **Add a typed detector or gate**, add a regression test, and **Search for the same pattern** in generated scaffolds and sibling modules.

### Safe git and shell habits

- After rename/index-touching commands: `git diff --cached --stat`; unstage mistakes with `git restore --staged`.
- When searching logs or code with shell metacharacters, prefer `rg -e 'pattern'` over unquoted grep.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or other git mutations unless explicitly asked.

### After finishing

```bash
kimi-githooks doctor
kimi-doctor --agent-ready
kimi-governance score --preflight --quick
# conventional commit
bun run sync && bun run sync:verify   # if runtime assets changed
```

## Where to find more

| Need                          | Reference                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Closest code exemplar         | `CODE_REFERENCES.md`                                                                                |
| Naming / ecosystem boundaries | `UNIFIED.md`                                                                                        |
| Template catalog              | `TEMPLATES.md`                                                                                      |
| Effect discipline depth       | `DEEP-QUALITY.md`                                                                                   |
| `src/lib/` domain map         | `src/lib/README.md`                                                                                 |
| Testing conventions           | `test/testing.md`                                                                                   |
| Herdr orchestration           | `docs/SCOPE.md`, `docs/handoff-rules.md`, `docs/finish-work-close-loop.md`, `skills/herdr/SKILL.md` |
| Kimi Code config / MCP        | `skills/kimi-toolchain/SKILL.md`                                                                    |
| Configuration layers          | `docs/references/configuration-layers.md`                                                           |
| Bun runtime scaffold defaults | `docs/references/bun-runtime-scaffold.md`                                                           |
| Shell spawn choice            | `docs/references/shell-spawn-choice.md`                                                             |
| Kimi-doctor reference         | `docs/references/kimi-doctor.md`                                                                    |

---

_Update when adding new tools, gates, or conventions._
