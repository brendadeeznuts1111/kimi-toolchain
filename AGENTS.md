# kimi-toolchain — Agent Guide

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding.
> This file is for AI coding agents. It assumes zero prior knowledge of the project.
> Refreshed from `package.json`, `bunfig.toml`, `dx.config.toml`, and the live source tree.

## Workspace setup (read first)

| Rule                     | Value                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| **Canonical clone path** | `~/kimi-toolchain` (folder name must match `package.json` `name`)                      |
| **Primary entry**        | `kimi-toolchain <tool> [args]` or `bun run <script>` from the repo root                |
| **Repo root**            | `git rev-parse --show-toplevel` or the workspace root — never assume an old clone path |

**Cursor / editor worktrees:** Cursor sometimes opens a git worktree under a temp path (`wt-match`, `.codex/worktrees`, `.grok/worktrees`, `herdr-worktrees`) where `package.json` is not materialized; Grep/Glob and `bun run` from the editor cwd then fail.

- **Preferred fix:** File → Open Folder → `~/kimi-toolchain` (canonical clone).
- **Automatic fallback:** `bun run unify`, `bun run verify-workspace`, and `kimi-toolchain workspace *` fall back to `~/kimi-toolchain` when the worktree lacks `package.json` (stderr warning emitted). Agents can also set `KIMI_PROJECT_ROOT` after `bun run unify`.

**After reopen checklist:** `pwd` ends with `kimi-toolchain` → `kimi-toolchain workspace verify` → `kimi-toolchain workspace cleanup` (audit legacy slugs, no delete by default) → if the slug persists: `kimi-toolchain workspace fix --deep`, quit Cursor fully, reopen `kimi-toolchain.code-workspace` → cross-check: `kimi-toolchain doctor --ecosystem --quick --json`.

## Machine Bun policy (developer Mac)

Applies on machines with `~/.bunfig.toml` machine SSOT. Monorepo details: `~/projects/docs/UNIFIED.md`.

| Component    | File                                                                    | Purpose                                                                                                                            |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Config SSOT  | `~/.bunfig.toml`                                                        | `linker = "isolated"`, `globalStore = true`, `frozenLockfile = true`, `minimumReleaseAge = 259200`, absolute `[install.cache].dir` |
| Env          | `~/.config/shell/bun.sh`                                                | `BUN_INSTALL`, `NO_PROXY`. Commented `BUN_CONFIG_*` only. **No** `BUN_INSTALL_GLOBAL_STORE`                                        |
| PATH         | `~/.config/shell/path.sh`                                               | PATH ownership                                                                                                                     |
| Verification | `bun_verify`, `bun run machine:bun`, `kimi-doctor --gate bunfig-policy` | Machine layer: `src/lib/machine-bun-policy.ts`                                                                                     |
| Audit        | `~/projects/scripts/audit-bunfig.sh`                                    | `--strict` fails on redundant install keys in workspace `bunfig.toml`                                                              |

**Config hierarchy** ([docs](https://bun.com/docs/pm/cli/install#configuring-bun-install-with-bunfig-toml)): machine `~/.bunfig.toml` + project `./bunfig.toml` (shallow merge; project wins) → `BUN_CONFIG_*` env → CLI flags. **This repo's `bunfig.toml`:** project-specific `[install]` (`frozenLockfile`, `globalDir`, scopes) + `[test]`/`[define]` — never duplicates machine `linker`, `globalStore`, `cache.dir`. Verify: `bverify` · `bmachine` · `cd ~/projects && bun run audit:bunfig`.

## Project overview

`kimi-toolchain` is a Bun-native CLI toolkit for project health checks, supply-chain security, governance scoring, session memory, git hooks, and scaffolding automation. It is a meta-project: the tools manage other projects.

Repo `https://github.com/brendadeeznuts1111/kimi-toolchain` · MIT · TypeScript (ESNext, strict) · Bun >= 1.4.0 · `bun pm` · repo runtime deps only `effect`, `js-yaml`; everything else Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.spawn`, etc.). The synced `~/.kimi-code` runtime deps are SSOT'd in `templates/desktop-runtime/package.json` (`effect`, `js-yaml`, `ts-morph`, `typescript`) and verified by `desktopRuntimeDepsOk` / `scripts/verify-desktop-runtime.ts`.

**Naming boundaries (do not conflate):**

| Layer                  | Product                                           | Canonical path                                   |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Agent**              | **Kimi Code** (`kimi`) — Moonshot Node SEA binary | `~/.kimi-code/bin/kimi`                          |
| **Toolchain**          | **kimi-toolchain** (this repo)                    | `~/kimi-toolchain/`                              |
| **Runtime extensions** | Synced tools/lib/governor/skills                  | `~/.kimi-code/tools/`, `~/.kimi-code/lib/`, etc. |
| **Global platform**    | **dx**                                            | `~/.config/dx/`, `~/.local/bin/dx`               |

- `kimi doctor` — official Kimi Code config check (not `kimi-doctor`, this repo's Bun diagnostics aggregator).
- Kimi Code config, MCP, sessions, slash commands: `skills/kimi-toolchain/SKILL.md`. One-shot setup: `bash scripts/unify.sh`.

## Key configuration files

| File                                                                | Purpose                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DIRECTIVE.md`                                                      | Pattern-Hardened Preservation Protocol v2.0.0 — Bun-native absolutism, 3× deletion metric, `[SURVIVORSHIP AUDIT]` / `[SELF-REJECT]` |
| `package.json`                                                      | Metadata, `bin` map (32 CLIs), scripts, deps, `trustedDependencies` policy                                                          |
| `bunfig.toml`                                                       | `[install]` policy, `[test]` defaults, `[define]` build-time constants                                                              |
| `tsconfig.json`                                                     | Strict, ESNext, bundler resolution, `noEmit`                                                                                        |
| `dx.config.toml`                                                    | DX policy: gate aliases, `[finishWork]` gates, `[herdr]` layout, `[cloudflare]` read-only, `[[endpoints]]`                          |
| `.oxfmtrc.json` / `.oxlintrc.json`                                  | `oxfmt` (printWidth 100) / `oxlint` (`typescript`, `unicorn`, `oxc`; correctness = error)                                           |
| `error-taxonomy.yml`                                                | Failure classification schema (`kimi-error`, `kimi-debug`, `kimi-heal`, failure ledger)                                             |
| `canonical-references.toml`                                         | SSOT for ecosystem doc links; edit, then `bun run references:generate`                                                              |
| `constants-manifest.json` / `constants-parity.toml`                 | Generated `[define]` discovery view / cross-repo parity SSOT                                                                        |
| `bun-native-lint.toml`                                              | Phased enforcement for `scripts/lint-bun-native.ts` (`off`/`report`/`enforce`)                                                      |
| `.bun-version` / `trusted-keys.json` / `types/build-constants.d.ts` | Pinned Bun runtime (`1.4.0`) / Ed25519 contract-signing keys / `[define]` type declarations                                         |

## Technology stack

Bun >= 1.4.0 · TypeScript (strict, ESNext, bundler resolution) · `bun:test` · SQLite via `bun:sqlite` (WAL) · `bunfig.toml` config · `bun pm` · Bun `$` shell · `oxfmt` + `oxlint` · `effect` for typed CLI/runner pipelines.

**Prefer Bun APIs over Node equivalents:** `Bun.file`, `Bun.write`, `new Bun.CryptoHasher("sha256")`, `Bun.spawn`, `await Bun.sleep(ms)`, `new Bun.Glob(...)`, `Bun.TOML.parse(...)`, `readableStreamToText()` (not `new Response(stream).text()`). `Buffer`, `TextEncoder`/`TextDecoder`, `Uint8Array` are native. Full exemplar map: `CODE_REFERENCES.md`.

**Bun 1.4.0 features we use** (shipped ≥1.3.9; [release notes](https://bun.com/blog/bun-v1.3.9)): `Symbol.dispose` auto-restore for `spyOn()`/`mock()` in tests (`using spy = spyOn(obj, "m")`), `NO_PROXY` honored with explicit `proxy:` fetch option (`src/lib/http-client.ts`), `bun run --parallel` for audit scripts, `Bun.Markdown` facade (`src/lib/bun-markdown.ts`), plus transparent JIT/intrinsic speedups. Regression coverage: `test/bun-release-compliance.unit.test.ts`.

## Architecture & code organization

### Top-level directories

| Directory                                        | Contents                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/bin/`                                       | CLI entry points (32 registered bins, below) + source-only tools via `bun run src/bin/<tool>.ts` or the `kimi-toolchain` router |
| `src/lib/`                                       | Shared library modules, flat by default; `src/lib/effect/` is the exception. Domain map: `src/lib/README.md`                    |
| `src/install-hooks/`                             | `postinstall.ts` — idempotent `~/.kimi-code/` setup after `bun install`                                                         |
| `src/kimi-hooks/`                                | Kimi Code lifecycle hooks declared in `~/.kimi-code/config.toml` `[[hooks]]`                                                    |
| `src/gates/`                                     | Built-in execution gates (`bunfig-policy`, `hardcoded-secrets`, `model-drift`, `tls-compliance`, …)                             |
| `src/harness/`                                   | Effect benchmark harness and perf monitors                                                                                      |
| `test/`                                          | Unit/integration/smoke/DB tests, helpers, fixtures. Author guide: `test/testing.md`                                             |
| `scripts/`                                       | Quality gate runners, lint sub-scripts, sync scripts, CI helpers                                                                |
| `skills/`                                        | Agent skills (synced to `~/.agents/skills/` and `~/.kimi-code/skills/`)                                                         |
| `templates/`                                     | Scaffold templates (`scaffold/`, `bun-create/`, `modules/`). See `TEMPLATES.md`                                                 |
| `docs/` · `contracts/`                           | ADRs, references, handoff rules · JSON contract samples                                                                         |
| `bench/` · `examples/` · `ci/` · `herdr-plugin/` | Benchmarks · Bun workspace demos · CI impact config · Herdr plugin                                                              |

### Registered CLI bins (`package.json` `bin`)

<!-- agents-sync:bins:begin -->

| Bin                      | Entry                               |
| ------------------------ | ----------------------------------- |
| `herdr-latm`             | `src/bin/herdr-latm.ts`             |
| `kimi-bake`              | `src/bin/kimi-bake.ts`              |
| `kimi-capabilities`      | `src/bin/kimi-capabilities.ts`      |
| `kimi-cleanup-legacy`    | `src/bin/kimi-cleanup-legacy.ts`    |
| `kimi-cloudflare-access` | `src/bin/kimi-cloudflare-access.ts` |
| `kimi-context-gen`       | `src/bin/kimi-context-gen.ts`       |
| `kimi-contract`          | `src/bin/kimi-contract.ts`          |
| `kimi-dashboard-mcp`     | `src/bin/kimi-dashboard-mcp.ts`     |
| `kimi-debug`             | `src/bin/kimi-debug.ts`             |
| `kimi-decision`          | `src/bin/kimi-decision.ts`          |
| `kimi-deep-audit`        | `src/bin/kimi-deep-audit.ts`        |
| `kimi-doctor`            | `src/bin/kimi-doctor.ts`            |
| `kimi-error`             | `src/bin/kimi-error.ts`             |
| `kimi-fix`               | `src/bin/kimi-fix.ts`               |
| `kimi-githooks`          | `src/bin/kimi-githooks.ts`          |
| `kimi-governance`        | `src/bin/kimi-governance.ts`        |
| `kimi-guardian`          | `src/bin/kimi-guardian.ts`          |
| `kimi-heal`              | `src/bin/kimi-heal.ts`              |
| `kimi-mcp`               | `src/bin/kimi-mcp.ts`               |
| `kimi-memory`            | `src/bin/kimi-memory.ts`            |
| `kimi-new`               | `src/bin/kimi-new.ts`               |
| `kimi-orphan-kill`       | `src/bin/kimi-orphan-kill.ts`       |
| `kimi-release`           | `src/bin/kimi-release.ts`           |
| `kimi-resource-governor` | `src/bin/kimi-resource-governor.ts` |
| `kimi-restore-baseline`  | `src/bin/kimi-restore-baseline.ts`  |
| `kimi-secrets`           | `src/bin/kimi-secrets.ts`           |
| `kimi-snapshot`          | `src/bin/kimi-snapshot.ts`          |
| `kimi-toolchain`         | `src/bin/kimi-toolchain.ts`         |
| `kimi-trace`             | `src/bin/kimi-trace.ts`             |
| `kimi-why`               | `src/bin/kimi-why.ts`               |
| `kimi-workflow`          | `src/bin/kimi-workflow.ts`          |
| `unified-shell-bridge`   | `src/bin/unified-shell-bridge.ts`   |

<!-- agents-sync:bins:end -->

### DX endpoints (`dx.config.toml` `[[endpoints]]`)

<!-- agents-sync:endpoints:begin -->

| Name                        | URL                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `cloudflare-mcp`            | https://mcp.cloudflare.com/mcp                                                               |
| `examples-artifact-lineage` | http://127.0.0.1:5678/api/artifacts/model-drift/lineage                                      |
| `examples-cards`            | http://127.0.0.1:5678/api/cards                                                              |
| `examples-dashboard`        | http://127.0.0.1:5678/                                                                       |
| `examples-health`           | http://127.0.0.1:5678/health                                                                 |
| `examples-showcase`         | http://127.0.0.1:5678/api/examples                                                           |
| `herdr-examples-health`     | http://127.0.0.1:18412/api/examples/health                                                   |
| `herdr-meta`                | http://127.0.0.1:18412/api/meta                                                              |
| `herdr-skill`               | https://github.com/ogulcancelik/herdr/blob/d998753efe506a04c80306795efc72bff60bb0ec/SKILL.md |

<!-- agents-sync:endpoints:end -->

### `src/lib/` domains (summary)

<!-- agents-sync:lib-domains:begin -->

| Domain         | Representative files                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Core**       | `utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`, `health-check.ts`, `logger.ts`                              |
| **Effect**     | `effect/` (`errors`, `config`, `tool-runner-effect`, `cli-runtime`)                                                 |
| **Governance** | `r-score.ts`, `governance-check.ts`, `governance.ts`, `readme-sync.ts`                                              |
| **Scaffold**   | `scaffold-templates.ts`, `scaffold-agents.ts`, `scaffold-aligned.ts`, `scaffold-doctor.ts`, `scaffold-quality.ts`   |
| **Cloudflare** | `cloudflare-access.ts`, `cloudflare-access-policy.ts`                                                               |
| **Governor**   | `governor-*.ts` (6 files)                                                                                           |
| **Memory**     | `memory-budget.ts`, `memory-sessions.ts`, `sessions-schema.ts`                                                      |
| **Git**        | `git-helpers.ts`, `conventional-commits.ts`, `changelog.ts`                                                         |
| **Config**     | `mcp-config.ts`, `kimi-config-audit.ts`, `test-gates.ts`, `test-runtime.ts`, `testing-docs-lint.ts`, `artifacts.ts` |
| **Health**     | `workspace-health.ts`, `workspace-commands.ts`, `legacy-cleanup.ts`, `ecosystem-health.ts`                          |
| **Process**    | `process-utils.ts`, `snapshot-core.ts`                                                                              |
| **Doctor**     | `doctor-runs.ts`, `doctor-pipeline.ts`                                                                              |
| **Sync**       | `desktop-sync.ts`                                                                                                   |
| **Registry**   | `tool-registry.ts`                                                                                                  |
| **Taxonomy**   | `error-taxonomy.ts`                                                                                                 |

<!-- agents-sync:lib-domains:end -->

### Three hook systems (do not conflate)

| System                        | Location                                                              | Purpose                                                                                    |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Git hooks**                 | `.git/hooks/` (installed by `kimi-githooks`)                          | `pre-commit` (format/lint/typecheck), `pre-push` (guardian + R-Score + sync + sync verify) |
| **Bun install hook**          | `src/install-hooks/postinstall.ts`                                    | Idempotent `~/.kimi-code/` setup after `bun install`                                       |
| **Kimi Code lifecycle hooks** | `src/kimi-hooks/`; declared in `~/.kimi-code/config.toml` `[[hooks]]` | Intercept `PreToolUse`, audit `PostToolUseFailure`, notifications                          |

### Live runtime (`~/.kimi-code/`)

`postinstall.ts` copies sources to `~/.kimi-code/` (`tools/`, `lib/`, `scripts/`, `mcp.json`, `skills/`, `var/`, `guardian/`, `governor/`, synced docs), initializes `var/sessions.db` (SQLite WAL), and writes `toolchain-manifest.json` (sha256 hashes).

**Do not edit `~/.kimi-code/` manually.** Use `bun run sync` (or `sync:daemon`) to push repo changes, and `bun run sync:verify` to check hashes.

## Build, test & quality gates

<!-- agents-sync:finish-work-gates:begin -->

| #   | Gate command                       |
| --- | ---------------------------------- |
| 1   | `bun run check:fast`               |
| 2   | `kimi-doctor --gate bunfig-policy` |
| 3   | `kimi-doctor --effect-gates`       |
| 4   | `kimi-doctor --automation`         |
| 5   | `kimi-heal effect audit`           |

<!-- agents-sync:finish-work-gates:end -->

**There is no build step.** TypeScript is run directly via `bun run`.

### Common commands

```bash
bun install
bun run check:fast            # fast iteration (~3s): format + lint + typecheck + unit tests
bun run test:fast             # unit tier;  bun test test/lib.unit.test.ts  for one file
bun run check                 # full gate (CI / pre-push);  --dry-run previews steps
bun run check:fast:changed    # only files changed vs main
bun run typecheck | format | format:check | lint
bun run doctor                # run tools from source (= src/bin/kimi-doctor.ts)
bun run check:template-policy # after editing templates/**
bun run sync && bun run sync:verify   # push repo → ~/.kimi-code/
```

**Pipelines:** `bun run check` (`scripts/check.ts`) = success-metrics → format:check → lint → typecheck → tests (`--fast` unit tier, `--skip-tests` omits). `bun run lint` (`scripts/lint.ts`) = `oxlint src test scripts` + ~20 convention/contract sub-lints; `--files <paths...>` scopes it, `--names-only` skips heavier checks.

### Gate layers

| Layer      | Command / hook                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | `bun run check` or `bun run unify`                                                                                                                          |
| pre-commit | `format:check` + `lint` + `typecheck` + `test:changed` via `kimi-githooks install`                                                                          |
| pre-push   | `check:fast:skip-tests` + guardian + effect-gates + R-Score + `test:changed:push` + mandatory `sync`/`sync:verify`; `KIMI_PRE_PUSH_FULL=1` for full `check` |
| Local CI   | `bun run ci:local`; `kimi-doctor` also runs gates unless `--quick`                                                                                          |
| Templates  | `bun run check:template-policy`; also in `quality:check:ci` and `verify:bun-features:strict`                                                                |

**Escape hatches:** `KIMI_SKIP_EFFECT_GATES=1` bypasses the Effect gate; `KIMI_SKIP_GOVERNANCE_PREFLIGHT=1` skips lock/README/guardian auto-fix before R-Score. Emergencies only; document in the commit message.

### R-Score & governance preflight

`kimi-governance score` grades license, CONTRIBUTING, CODEOWNERS, README, changelog (bonus), coverage, docs freshness, lockfile staleness: A ≥90% … F <60%. Pre-push blocks D/F. Preflight (`src/lib/governance-preflight.ts`) auto-fixes stale `bun.lock`, missing README scripts, guardian baseline.

```bash
kimi-governance score --preflight --quick   # manual pre-push check
bun run finish-work --message "..." --push  # gates + commit + push close-loop
```

### Success metrics

`kimi-doctor --success-metrics` gives pass/fail: **Drift latency** (documented commands checkable in one doctor run), **Error coverage** (≥90% of managed failures get a taxonomy code + structured context), **Integration agility** (new provider = contract + thin `getSecret(scope)` adapter). These metrics are not frozen — threshold changes follow the toolchain release cadence and need failure ledger evidence.

## Agent Introspection

Prefer structured probes before debugging: `kimi-capabilities --json`, `kimi-trace <trace-id> --json`, `kimi-contract validate --json`, `kimi-why <topic> --json`. Effect-native: `KimiIntrospectionLive`; self-healing lives in `src/lib/self-healing.ts` — inspect before changing `kimi-heal`.

## Testing strategy

- **SSOT:** `src/lib/test-runtime.ts` (Bun contracts `BUN_TEST_*`/`KIMI_*`, tier runners) · **File lists:** `src/lib/test-gates.ts` (`UNIT_TEST_FILES`, `INTEGRATION_TEST_FILES`, `SMOKE_TEST_FILES`) · **Author guide:** `test/testing.md`.
- **Preload/isolation:** `bunfig.toml` `[test].preload = ["./test/setup.ts"]` sets `KIMI_TEST_HOME`; use `withIsolatedHome()` / `withEnv()` from `test/helpers.ts`.

| Tier        | Command                    | Files                        | Timeout  |
| ----------- | -------------------------- | ---------------------------- | -------- |
| Unit (fast) | `bun run test:fast`        | `UNIT_TEST_FILES`            | 30 s     |
| Integration | `bun run test:integration` | `INTEGRATION_TEST_FILES`     | 30 s     |
| Smoke       | `bun run test:smoke`       | `test/smoke/*.smoke.test.ts` | 60 s     |
| All         | `bun run test`             | unit → integration → smoke   | per tier |

**File naming** (`scripts/lint-test-names.ts`): `{stem}.unit.test.ts` (fast gate), `.integration.test.ts`, `.smoke.test.ts` (`test/smoke/`), `.db.test.ts` (sequential). Top-level `describe("…")` is kebab-case starting with the file stem.

**Essential rules** (full list: `test/testing.md`): import test symbols explicitly from `"bun:test"`; Bun APIs over `node:fs` sync I/O; never assign `process.env.*` / `console.log` without helpers (`withEnv()`, `captureConsole()`); `testTempDir()` + `cleanupPath()` in `finally`; smoke tests via `invokeTool()`; tier scripts, not bare `bun test`, in hooks/CI.

## Code style guidelines

- **Imports:** relative from `src/lib/` / `src/lib/effect/`; never absolute paths or aliases. Core files (`utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`) are imported by almost everything — keep them lightweight and dependency-free.
- **Path helpers:** all paths under `~/.kimi-code/` must use `src/lib/paths.ts` helpers (`homeDir`, `toolsDir`, `varDir`, `guardianDir`, `mcpPath`, `configTomlPath`, `manifestPath`, …). **Never hardcode `~/.kimi-code` strings in source.**
- **Safe parsing:** `safeParse<T>()` / `safeToml<T>()` from `src/lib/utils.ts` instead of unchecked `JSON.parse` / `TOML.parse` casts.

### Build-time constants

| Layer               | Purpose                             | Format                                      | Where                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| **define constant** | Immutable compile-time tuning       | `KIMI_{DOMAIN}_{QUALIFIER}` SCREAMING_SNAKE | `bunfig.toml` `[define]`, `types/build-constants.d.ts` |
| **defineDomain**    | Group constants by functional slice | kebab-case, matches lib module              | `# define-domain:…` in bunfig, `@defineDomain` JSDoc   |
| **taxonomyId**      | Classify tool/runtime **failures**  | snake*case `{domain}*{reason}`              | `error-taxonomy.yml`, failure JSONL                    |

Rules: keys start with `KIMI_`; booleans end with `_ENABLED` (never `ENABLE_*`); paths/versions include the domain; change values only in `bunfig.toml`, extend `types/build-constants.d.ts` when adding one, and regenerate with `bun run manifest:generate`; `bun run lint` enforces naming/parity.

### CLI tools

Each `src/bin/` tool is a self-contained Bun script (`#!/usr/bin/env bun`) sharing `../lib/utils.ts` / `../lib/version.ts`, with at minimum a `doctor` subcommand and `fix` where applicable.

| Need                           | Use                                                 | Avoid                                                |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Invoke another toolchain CLI   | `invokeTool()` / `runTool()` (`tool-runner.ts`)     | Raw `Bun.spawn(["bun", "run", ...])` in feature code |
| Invoke from Effect code        | `invokeToolEffect()` / `runToolEffect()`            | Converting errors to untyped strings                 |
| Parse common CLI flags         | `createCli(Bun.argv, toolName)` (`cli-contract.ts`) | Ad-hoc `Bun.argv.includes("--json")`                 |
| Emit structured health results | `logger.check()` / `logger.printHealthReport()`     | Ad hoc JSON shapes                                   |
| Long/noisy subprocess output   | `maxOutputBytes` on `invokeTool()`                  | Unbounded stream capture                             |

### Effect discipline

Use Effect when a CLI path needs typed failures, telemetry-safe cleanup, or parallel orchestration — not for simple pure helpers. Wrap CLI mains in `runCliExit()` (`src/lib/effect/cli-runtime.ts`); use tagged errors (`src/lib/effect/errors.ts`); preserve taxonomy fields (`taxonomyId`, `suggestion`, `autoFix`) across subprocess boundaries; no scattered `process.exit()`. Before committing: `kimi-doctor --effect-gates` + `kimi-heal effect audit`. Full contract: `DEEP-QUALITY.md`.

### Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Security considerations

- **No secrets in source.** Use `Bun.env` or `Bun.secrets`. The pre-commit hook blocks `.env` files.
- **Env drift check.** `bun run check:env-drift` compares `.env` vs `.env.example`; runs in `check`/`check:fast`, skips safely when `.env` is absent (CI).
- **Guardian** baselines `bun.lock` hashes and signs manifests with HMAC (key in macOS Keychain or `~/.kimi-code/guardian/.key`, `chmod 600`).
- **CVE scanning** uses the OSV API (`api.osv.dev`).
- **Trusted dependencies:** lifecycle scripts must be in `package.json` `trustedDependencies`; `kimi-guardian check` audits, `kimi-guardian fix` / `bun pm trust <pkg>` adds entries.
- **Install policy:** machine `~/.bunfig.toml` owns `linker`, `globalStore`, `cache.dir`; repo `bunfig.toml` holds project `[install]` only. CLI SSOT: `BUN_INSTALL_CLI` in `src/lib/bun-install-config.ts`.
- Validate all external input at system boundaries.

**Cloudflare API token:** `kimi-cloudflare-access` reads `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, or the OS keychain via `... login`. Permissions: Account > Access: Read (`tokens`, `apps`, `doctor`) / Edit (`fix`). Cloudflare MCP OAuth, Wrangler OAuth, and API tokens are separate auth paths.

## Deployment & distribution

- **No build step.** TypeScript runs via `bun run`. Distribution: GitHub repo; `bun install -g github:brendadeeznuts1111/kimi-toolchain`.
- **Live runtime:** `~/.kimi-code/` maintained by `postinstall.ts` + `scripts/sync-to-desktop.ts`. **Global PATH wrappers:** `scripts/install-bin-wrappers.sh` → `~/.local/bin/kimi-*` stubs.

When tools, docs, skills, templates, or generated runtime assets change, final handoff validation must include `bun run sync && bun run sync:verify`.

## Agent workflow & conventions

**Before a long session:** `kimi-doctor --agent-ready` · `kimi-doctor --quick` · `kimi-orphan-kill --dry-run` (if needed) · `kimi-governance score --preflight --quick`.

**During iteration (step-budget discipline):** `test:fast` (~5s) over `test` (~15s); `check:fast` (~3s) over `check` (~30s); `bun test <file>` over re-running the suite; `kimi-doctor --quick` over full doctor. Batch edits → `check:fast` → fix → repeat → `bun run check` before commit.

**Agent Operating Loop:** **Scope** — read `CODE_REFERENCES.md`, pick the closest pattern, name the smallest change slice. **Implement** — keep parsing, mutation, subprocess, telemetry boundaries typed and local to established modules. **Guard** — no one-off patches: add a detector/gate + regression test, sweep siblings for the same pattern. **Validate** — targeted tests first, then `check:fast`; full checks at handoff.

**Safe git and shell habits:**

- After rename/index-touching commands: `git diff --cached --stat`; unstage mistakes with `git restore --staged`.
- Prefer `rg -e 'pattern'` over unquoted grep with shell metacharacters.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or other git mutations unless explicitly asked.

**After finishing:** `kimi-githooks doctor` · `kimi-doctor --agent-ready` · `kimi-governance score --preflight --quick` · conventional commit · `bun run sync && bun run sync:verify` (if runtime assets changed).

## Where to find more

- Exemplars `CODE_REFERENCES.md` · naming `UNIFIED.md` · Effect depth `DEEP-QUALITY.md` · lib map `src/lib/README.md`
- Templates `TEMPLATES.md` · `skills/create-template/SKILL.md` · `docs/references/template-matrix.md` · skill index `bun run skills:table`
- Testing `test/testing.md` · `docs/references/testing-execution.md`
- Herdr `docs/SCOPE.md`, `docs/handoff-rules.md`, `docs/finish-work-close-loop.md`, `skills/herdr/SKILL.md`
- Kimi Code config/MCP `skills/kimi-toolchain/SKILL.md` · more in `docs/references/` (configuration-layers, bun-runtime-scaffold, shell-spawn-choice, kimi-doctor) · `docs/flake-register.md` · `docs/naming.md` · `docs/rgignore.md`

---

_Update when adding new tools, gates, or conventions._
