# kimi-toolchain — Agent Guide

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding.
> This file is for AI coding agents. It assumes zero prior knowledge of the project.

## Workspace (read first)

| Rule                     | Value                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| **Canonical clone path** | `~/kimi-toolchain`                                                                |
| **Folder name**          | Must be `kimi-toolchain` (matches `package.json` `name`)                          |
| **Cursor**               | File → Open Folder → `~/kimi-toolchain` (not `$HOME`, not symlink)                |
| **Repo root**            | Use `git rev-parse --show-toplevel` or workspace root — never assume an old clone |

If Grep/Glob fail with a path under an old renamed clone, the editor opened the wrong folder. Reopen `~/kimi-toolchain`.

**Before writing code:**

1. Read `~/.config/dx/AGENTS.md` for the global DX layer.
2. Run `dx context`, `dx config`, `dx mcp-status`, or `dx mcp-doctor` when the task touches global setup, MCP, package, or shell behavior.
3. Read `./CODE_REFERENCES.md`, pick the closest existing pattern, and preserve local conventions before editing.
4. Cloudflare SSO/OAuth is separate from Wrangler OAuth and `kimi-cloudflare-access` API tokens; do not assume one login satisfies another.
5. Keep Success Metrics green: Drift latency, Error coverage, and Integration agility are checked by `kimi-doctor --success-metrics`.

**After reopen checklist:**

1. `pwd` ends with `kimi-toolchain`
2. `kimi-toolchain workspace verify` (or `bun run verify-workspace`)
3. `kimi-toolchain workspace cleanup` — audit legacy Cursor slugs (no delete by default)
4. If slug persists: `kimi-toolchain workspace fix --deep` then **quit Cursor fully** and reopen `kimi-toolchain.code-workspace`
5. Full cross-product check: `kimi-toolchain doctor --ecosystem --quick --json`

**Primary entry:** `kimi-toolchain <tool> [args]` — legacy `kimi-*` commands dispatch through it. See [UNIFIED.md](UNIFIED.md) for the path map.

## Project Overview

`kimi-toolchain` is a Bun-native CLI toolkit that provides project health checks, supply-chain security, governance scoring, session memory, git hooks, and scaffolding automation. It is a meta-project: the tools manage other projects.

- **Repository**: `https://github.com/brendadeeznuts1111/kimi-toolchain`
- **License**: MIT
- **Language**: TypeScript (ESNext, strict mode)
- **Runtime**: Bun >= 1.3.14
- **Minimal runtime dependencies** — `effect` and `js-yaml`; everything else uses Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.spawn`, etc.)

## Architecture

### Repo layout

Authoritative maps — do not duplicate stale trees here:

| Need | Source |
| ---- | ------ |
| CLI entry points (27 registered bins) | `package.json` `bin` + `src/bin/*.ts` |
| Tool routing | [UNIFIED.md](UNIFIED.md) |
| Shared library | `src/lib/` (flat by default; `src/lib/effect/` for Effect adapters) |
| Library domain guide | `src/lib/README.md` |
| Unit vs smoke vs integration tests | `src/lib/test-gates.ts` (`UNIT_TEST_FILES`, `SMOKE_TEST_FILES`, `INTEGRATION_TEST_FILES`) |
| Coding exemplars | [CODE_REFERENCES.md](CODE_REFERENCES.md) |
| Canonical ecosystem links | `canonical-references.json` (`bun run references:generate`; cached at `~/.kimi-code/`) |
| Scaffolding templates | [TEMPLATES.md](TEMPLATES.md) |
| Failure taxonomy | `error-taxonomy.yml` (synced to `~/.kimi-code/`) |
| Build-time constants | `bunfig.toml` `[define]` + `types/build-constants.d.ts` |

Top-level dirs: `src/` (bins, lib, install-hooks, kimi-hooks), `test/`, `scripts/`, `skills/`, `docs/`, `bench/`, `templates/`.

### Live runtime (managed by `postinstall`)

`postinstall.ts` copies sources to `~/.kimi-code/` (`tools/`, `lib/`, `scripts/`, `mcp.json`, `skills/`, `var/`, `guardian/`, `governor/`, synced docs).

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
- Kimi Code config, MCP, sessions, slash commands: see `skills/kimi-toolchain/SKILL.md`.
- One-shot setup: `bash scripts/unify.sh`.

## Success Metrics

These contracts describe what “better code by future agents” means in this repo.
Run `kimi-doctor --success-metrics` for a single pass/fail view; `bun run check`
also runs the same audit.

| Metric                  | Required default                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drift latency**       | Documented commands, samples, and help examples must be checkable in one `kimi doctor` or `kimi-doctor` run without manual inspection.        |
| **Error coverage**      | >= 90% of managed contract, hook, and integration failures must get a taxonomy code plus structured stack, input, and environment context.    |
| **Integration agility** | New cloud providers are represented by only two artifacts: a contract declaration and a thin `getSecret(scope) -> string` credential adapter. |

The metrics are not frozen. As the toolchain learns, the taxonomy may expand,
the definition of core logic may tighten, and new metrics may emerge from the
failure ledger. The release cadence for metrics is the toolchain release
cadence. Any metric threshold change must update the threshold metadata in
`src/lib/success-metrics.ts` with a justification and ledger evidence from
`~/.kimi-code/var/tool-failures.jsonl`.

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
| Formatter       | `oxfmt` (config: `.oxfmtrc.json`)                      |
| Linter          | `oxlint` (config: `.oxlintrc.json`)                    |

## Build, Test & Quality Gates

All commands run from the repo root.

```bash
bun install

# Fast iteration (~3s): format + lint + typecheck + 94 unit files
bun run check:fast
bun run test:fast

# Full gate (CI / pre-push): format:check + lint + typecheck + all tests
bun run check

# Preview gate steps without running them
bun run check:dry-run

# TypeScript (no emit)
bun run typecheck

# Format / lint (oxfmt / oxlint — do not add ESLint)
bun run format           # oxfmt --write .
bun run format:check     # oxfmt --check .
bun run lint             # oxlint + banned-terms + pattern lints + bun-native + context-bloat + test-names + build-constants + canonical-references + constant-parity + cli-contract

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

When tools, docs, skills, templates, or generated runtime assets change, final
handoff validation must include `bun run sync && bun run sync:verify`.

### Gate layers

| Layer      | Command / hook                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- |
| Local      | `bun run check` or `bun run unify`                                                           |
| pre-commit | `format:check` + `lint` + `typecheck` (via `kimi-githooks install`)                          |
| pre-push   | `check:fast` + guardian + effect-gates + constant-drift + R-Score (preflight auto-fix via `--hook`) + mandatory runtime sync   |
| Local CI   | `bun run ci:local` — format:check, lint, typecheck, test, coverage, effect-gates, governance |
| Doctor     | `kimi-doctor` Code Quality section (runs gates unless `--quick`)                             |

**Server CI note:** GitHub Actions is disabled for this account due to a billing lock. Enforcement is local only: pre-push hooks and `bun run ci:local`. The disabled workflow is preserved at `.github/workflows-disabled/ci.yml` for reference.

**Escape hatches:** `KIMI_SKIP_EFFECT_GATES=1` bypasses the Effect-discipline gate; `KIMI_SKIP_GOVERNANCE_PREFLIGHT=1` skips lock/README/guardian auto-fix before R-Score. Use only in emergencies and document the bypass in the commit message.

Install hooks: `kimi-githooks install` or `kimi-githooks fix` to refresh outdated hooks.

### R-Score & governance preflight

`kimi-governance score` checks license, CONTRIBUTING, CODEOWNERS, README, CONTEXT, changelog (bonus), test coverage, docs freshness, and lockfile staleness. Grades: A (≥90%), B (≥80%), C (≥70%), D (≥60%), F (<60%). Pre-push blocks D and F.

**Governance preflight** (`src/lib/governance-preflight.ts`) runs automatically before hook scoring and on `kimi-governance score --preflight`:

| Action | When |
| ------ | ---- |
| `lockfile_refreshed` | `package.json` mtime newer than `bun.lock` (scripts-only edits) |
| `readme_patched` | README missing `package.json` scripts |
| `guardian_baselined` | Guardian hash missing or mismatched |

```bash
kimi-governance score --preflight --quick   # manual pre-push check
bun run finish-work --message "..." --push  # gates + commit + push close-loop
```

## Testing Strategy

- **Test runner**: `bun:test` (built into Bun)
- **Fast gate**: 94 unit files in `UNIT_TEST_FILES` (`test-gates.ts`); 1,500ms timeout per test
- **Smoke**: `test/smoke/` — full CLI invocations (`bun run test:smoke`)
- **Integration**: `INTEGRATION_TEST_FILES` in `test-gates.ts` — full suite only
- **Isolation**: Unit tests use a temporary `HOME` (`Bun.env.KIMI_TEST_HOME`, default `.tmp-kimi-test-home`) so they never touch the real `~/.kimi-code/`
- **Shared setup**: `test-setup.ts` → `test/setup.ts` runs before every test file
- **Helpers**: `test/helpers.ts` — Bun-native temp dirs, HOME isolation, env mocks, console capture
- **Conventions**: `test/testing.md` — golden rules and example patterns for all test files
- **Timeout**: Default 30s per test; 60s for smoke tests; 1,500ms for fast unit gate
- **Config**: `bunfig.toml` `[test]` sets preload, concurrent glob, bail, randomize seed, dots reporter, and coverage ignores

## Code Organization

### Path helpers (`src/lib/paths.ts`)

All paths under `~/.kimi-code/` must use `src/lib/paths.ts` helpers. **Never hardcode `~/.kimi-code` or `~/.kimi-code/...` strings in source.**

Key exports: `homeDir`, `desktopRoot`, `toolsDir`, `libDir`, `scriptsDir`, `varDir`, `guardianDir`, `governorDir`, `memoryDir`, `skillsDir`, `kimiHooksDir`, `mcpPath`, `configTomlPath`, `manifestPath`, `canonicalReferencesPath`, `taxonomyPath`, `failureLedgerPath`, `projectKimiDir`, `contractObservationsPath`, `agentsSkillsRoot`, `localBinDir`, `herdrConfigDir`, `cursorDir`, etc.

Import: `import { desktopRoot, toolsDir } from "../lib/paths.ts";` (adjust depth as needed).

### Safe parse helpers (`src/lib/utils.ts`)

Use `safeParse<T>()` and `safeToml<T>()` instead of unchecked `JSON.parse` / `TOML.parse` casts.

### CLI tools (`src/bin/`)

Each tool is a self-contained Bun script with a `#!/usr/bin/env bun` shebang. They share `../lib/utils.ts` and `../lib/version.ts`. Every tool supports at minimum a `doctor` subcommand and a `fix` subcommand where applicable.

### Hooks taxonomy

Do not conflate these three hook systems:

| System                        | Location                                                                      | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Git hooks**                 | Installed into `.git/hooks/` by `kimi-githooks`                               | `pre-commit`, `pre-push` policy gates                                   |
| **Bun install hook**          | `src/install-hooks/postinstall.ts`                                            | Idempotent `~/.kimi-code/` setup after `bun install`                    |
| **Kimi Code lifecycle hooks** | `src/kimi-hooks/` scripts; declared in `~/.kimi-code/config.toml` `[[hooks]]` | Intercept `PreToolUse`, audit `PostToolUseFailure`, notifications, etc. |

Canonical failure ledger: `~/.kimi-code/var/tool-failures.jsonl` (classified by `src/kimi-hooks/log-tool-failure.ts`).

### Tool invocation & logging

See [CODE_REFERENCES.md](CODE_REFERENCES.md) for the exemplar map. Summary:

| Need                            | Use                                                                         | Avoid                                                     |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Invoke another toolchain CLI    | `invokeTool()` / `runTool()` from `tool-runner.ts`                          | Raw `Bun.spawn(["bun", "run", ...])` in feature code      |
| Invoke from Effect code         | `invokeToolEffect()` / `runToolEffect()`                                    | Converting every error to an untyped string               |
| Parse common CLI flags          | `createCli(Bun.argv, toolName)` from `cli-contract.ts`                      | Ad-hoc `Bun.argv.includes("--json")` in every tool        |
| Emit structured health results  | `logger.check()` / `logger.printHealthReport()`                             | Ad hoc JSON shapes                                        |
| Long or noisy subprocess output | `maxOutputBytes` on `invokeTool()`                                          | Unbounded stream capture                                  |

Runner defaults: 30s human timeout, 15s agent/CI timeout, 5s SIGTERM-to-SIGKILL grace, 1 MiB retained output per stream. JSON mode must emit `schemaVersion`, `tool`, `level`, `message`, and `timestamp`.

### Reference code before writing

| New work                        | Read first                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| New CLI main                    | `src/lib/effect/cli-runtime.ts`, `src/lib/cli-contract.ts`, `src/bin/kimi-toolchain.ts`                 |
| New cross-tool call             | `src/lib/tool-runner.ts`, `src/lib/effect/tool-runner-effect.ts`                                        |
| New doctor/check output         | `src/lib/cli-contract.ts`, `src/lib/logger.ts`, `src/lib/health-check.ts`, `src/lib/doctor-pipeline.ts` |
| New config or schema parser     | `src/lib/cloudflare-access-policy.ts`, `src/lib/mcp-config.ts`, `src/lib/kimi-config-audit.ts`          |
| New package/dependency behavior | `package.json`, `bunfig.toml`, `src/lib/scaffold-quality.ts`, `kimi-guardian check`                     |
| New scaffold/agent docs         | `src/lib/scaffold-agents.ts`, `TEMPLATES.md`, `test/scaffold-agents.unit.test.ts`                       |
| Doctor adapters/plugins/MCP     | [CODE_REFERENCES.md](CODE_REFERENCES.md) § Doctor Adapter / Plugin / MCP                                |
| Herdr orchestration             | `src/lib/herdr-project-config.ts`, `docs/SCOPE.md`, `docs/handoff-rules.md`, `skills/herdr/SKILL.md`    |

### Bun-native coding standards

**Always prefer Bun APIs over Node equivalents.**

| Task          | Use                                  | Avoid                                 |
| ------------- | ------------------------------------ | ------------------------------------- |
| Read file     | `Bun.file(path).text()` / `.json()`  | `fs.readFileSync`                     |
| Write file    | `Bun.write(path, data)`              | `fs.writeFileSync`                    |
| Hash          | `new Bun.CryptoHasher("sha256")`     | `crypto.createHash`                   |
| Spawn         | `Bun.spawn(cmd, { stdout: "pipe" })` | `child_process.spawn`                 |
| Sleep         | `await Bun.sleep(ms)`                | `new Promise(r => setTimeout(r, ms))` |
| Glob          | `new Bun.Glob(pattern)`              | `fs.readdir` + regex                  |
| TOML          | `Bun.TOML.parse(text)`               | `@iarna/toml`                         |
| Stream → text | `Bun.readableStreamToText(stream)`   | `new Response(stream).text()`         |

Use `Uint8Array` instead of `Buffer`. Use `await proc.exited` for exit codes. For resource-limited spawning, use `governedSpawn()` from `src/lib/governor-spawn.ts`.

`src/lib/` is flat by default; new subdirectories need rationale in `src/lib/README.md`. Use relative imports — never path aliases.

### Build-time constants

Three layers must stay separate:

| Layer               | Purpose                             | Format                                      | Example                                  | Where                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| **define constant** | Immutable compile-time tuning       | `KIMI_{DOMAIN}_{QUALIFIER}` SCREAMING_SNAKE | `KIMI_HOOK_VERIFIER_MAX_CYCLES`          | `bunfig.toml` `[define]`, `types/build-constants.d.ts` |
| **defineDomain**    | Group constants by functional slice | kebab-case, matches lib module              | `contract-inference`, `error-embedding`  | `# define-domain:…` in bunfig, `@defineDomain` JSDoc   |
| **taxonomyId**      | Classify tool/runtime **failures**  | snake_case `{domain}_{reason}`              | `lockfile_issue`, `format_check_failure` | `error-taxonomy.yml`, failure JSONL                    |

- Change tuning values only in `bunfig.toml` `[define]`.
- Extend `types/build-constants.d.ts` declarations when adding a constant.
- Regenerate and verify the manifest with `bun run manifest:generate`.
- `bun run lint` enforces constant naming and parity via `scripts/lint-build-constants.ts` and related lints.

### Process cache

`src/lib/process-utils.ts` and `src/lib/memory-budget.ts` share a 1s TTL cache for `ps` output. Call `clearProcessCache()` to invalidate within a doctor run.

## Agent Workflow

### Defaults

| Setting              | Recommendation                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| **Permission mode**  | `auto` for safe paths (tests, docs), `manual` for destructive ops        |
| **Background tasks** | Keep `keep_alive_on_exit = false` unless explicitly daemonizing          |
| **Loop control**     | `max_steps_per_turn` unset in `config.toml` (unlimited)                  |
| **Session memory**   | Use `kimi-memory store` for cross-session context, not file hacks        |

**Before a long session:** `kimi-doctor --agent-ready` → `kimi-doctor --quick` → `kimi-orphan-kill --dry-run` if needed → `kimi-governance score --preflight --quick`.

**During iteration (step-budget discipline):**

| Instead of                                                    | Use                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `bun test` (full suite incl. smoke, ~15s)                     | `bun run test:fast` (94 unit files, ~5s)                     |
| `bun run check` (~30s)                                        | `bun run check:fast` (~3s)                                   |
| Re-running full suite after every edit                        | `bun test <specific-file>`                                   |
| `kimi-doctor` without `--quick`                               | `kimi-doctor --quick`                                        |

Batch edits (up to 5–8 files) → `bun run check:fast` → fix failures → repeat → `bun run check` before commit.

**After finishing:** `kimi-githooks doctor` → `kimi-doctor --agent-ready` → `kimi-governance score --preflight --quick` → conventional commit → `bun run sync && bun run sync:verify` if runtime assets changed.

### Effect discipline

When a session touches Effect code, run Effect gates before committing. Full contract: [DEEP-QUALITY.md](DEEP-QUALITY.md).

```bash
kimi-doctor --effect-gates
kimi-heal effect audit --check-tags --event-streams --json
```

### Agent diagnosis & doctor hub

```bash
kimi-doctor --agent --json    # structured AgentDiagnosisReport
kimi-doctor --probe           # capability manifest for agents
kimi-doctor --adapter <name>  # oxlint, typecheck, guardian, governance, ...
kimi-doctor --all             # every adapter + plugins + effect-gates
```

Adapters, plugins, MCP tools, and JSON contracts: [CODE_REFERENCES.md](CODE_REFERENCES.md) § Doctor Adapter / Plugin / MCP. Register MCP via `kimi-doctor --fix`.

### Commit convention

Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Security Considerations

- **No secrets in source.** Use `Bun.env` or `Bun.secrets`.
- **Pre-commit hook** blocks `.env` files from being committed.
- **Guardian** baselines `bun.lock` hashes and signs manifests with HMAC (key in macOS Keychain or `~/.kimi-code/guardian/.key` with `chmod 600`).
- **CVE scanning** uses the OSV API (`api.osv.dev`).
- **Trusted dependencies** gate: dependency lifecycle scripts must be listed in `package.json` `trustedDependencies` (Bun SSOT). `kimi-guardian check` audits; `kimi-guardian fix` or `bun pm trust <pkg>` adds entries. Secure install policy lives in `bunfig.toml` `[install]` (see `src/lib/bun-install-config.ts`): `frozenLockfile`, `linker = "isolated"`, `minimumReleaseAge`, `globalDir` / `globalBinDir` for `bun install -g`. CLI SSOT: `BUN_INSTALL_CLI` in `bun-install-config.ts` (`bun ci`, `bun add <pkg>`, `bun update <pkg>`, `kimi-guardian fix`). Taxonomy `lockfile_issue` uses the same strings. Bun merges `$HOME/.bunfig.toml` with project `bunfig.toml`; `BUN_CONFIG_*` env overrides.
- Validate all external input at system boundaries.

## Memory Budget (16 GB)

On memory-constrained hosts, swap thrashing inflates load before CPU looks busy.

| Rule                                                                                                  | Why                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Do **not** run Chrome + Kimi Desktop + kimi CLI + cursor-agent concurrently                           | Chrome alone can use ~5 GB                  |
| **No Docker** on this machine — use Bun-native dev (`dx.config.toml` `[runtime].containers = "none"`) | Docker VM was ~600MB idle overhead          |
| Run `bun run memory-check` or `kimi-doctor --quick` before long agent sessions                        | Catches low RAM / high swap early           |
| Use **kimi CLI OR Kimi Desktop**, not both                                                            | Duplicate Electron/Node stacks              |
| Never run `bun run sync:daemon` unless developing toolchain                                           | Background Bun cron every 5 min             |
| Run `kimi-orphan-kill --dry-run` weekly                                                               | Cleans stale `bun test` / kimi-tool orphans |

**Governor config:** `~/.kimi-code/governor/defaults.toml` — `maxParallelJobs` caps at 2 when free RAM < 2 GB.

## Deployment / Distribution

- **No build step.** TypeScript is run directly via `bun run`.
- **Distribution**: GitHub repo, `bun install -g github:brendadeeznuts1111/kimi-toolchain`.
- **Live runtime**: `~/.kimi-code/` maintained by `postinstall.ts` and `sync-to-desktop.ts`; sync writes `toolchain-manifest.json` with file hashes.

## Project docs (active)

| Doc | Purpose |
| --- | --- |
| `docs/SCOPE.md` | Herdr orchestration production validation scope |
| `docs/finish-work-close-loop.md` | Finish-work pipeline and escalation |
| `docs/handoff-rules.md` | Cross-pane handoff contract |
| `docs/naming.md` | Session and pane naming conventions |
| `docs/flake-register.md` | Known flaky tests and mitigations |
| `docs/references/shell-spawn-choice.md` | When to use `Bun.spawn` vs `governedSpawn` |
| `docs/references/bun-shell-companions.md` | Bun `$` template vs subprocess patterns |

## Quick Reference: All CLI Tools

| Tool                     | Key Commands                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `kimi-toolchain`         | Unified router — `kimi-toolchain <tool> [args]` (see UNIFIED.md)                                                  |
| `kimi-doctor`            | `doctor`, `doctor --fix`, `doctor --quick`, `doctor --memory-budget`, `--agent`, `--probe`, `--adapter`, `--all`  |
| `kimi-orphan-kill`       | `--dry-run` (cleanup stale test/tool processes)                                                                   |
| `kimi-fix`               | `fix <path>`, `fix <path> --profile app\|toolchain`, `fix <path> --dry-run`                                       |
| `kimi-governance`        | `score`, `score --preflight`, `fix`, `coverage [N]`, `docs`, `adr <title>`, `doctor`                             |
| `kimi-guardian`          | `check`, `sign`, `verify`, `report`, `fix`, `doctor`                                                              |
| `kimi-memory`            | `store`, `recall`, `resume`, `autosave`, `graph`, `impact`, `search`, `prune`, `stats`, `trends`, `doctor`, `fix` |
| `kimi-githooks`          | `install`, `doctor`, `fix`                                                                                        |
| `kimi-cloudflare-access` | `login`, `logout`, `tokens`, `apps`, `doctor`, `fix` (token expiry, app policy audit)                             |
| `kimi-context-gen`       | `scan`, `update`, `freshness`, `doctor`, `fix [threshold]`                                                        |
| `kimi-release`           | `changelog`, `semver`, `validate`, `doctor`, `fix`                                                                |
| `kimi-debug`             | `last`, `diff`, `trace`, `analyze`, `classify`, `taxonomy`, `wire [path]`, `doctor`, `fix`                        |
| `kimi-snapshot`          | `save`, `restore`, `list`, `show`, `cleanup`, `doctor`, `fix`                                                     |
| `kimi-resource-governor` | `limits`, `parallel`, `quota`, `cache`, `spawn`, `session`, `cleanup`, `status`, `doctor`, `fix`                  |
| `kimi-heal`              | `plan`, `apply`, `clusters`, `effect audit`                                                                       |
| `kimi-decision`          | `graph`, `why`, `audit`                                                                                           |
| `kimi-config`            | Kimi Code config audit/fix                                                                                        |
| `kimi-identity`          | Identity matrix audit                                                                                             |
| `kimi-new`               | Scaffold a new Bun project                                                                                        |
| `kimi-cleanup-legacy`    | Clean up deprecated `~/.kimi` / Cursor slug paths                                                                 |
| `unified-shell-bridge`   | MCP stdio bridge for `mcp__unified-shell__execute`                                                                |
| `herdr-orchestrator`     | `status`, `react`, `context-sync`, `escalate`, `watch-events`, `dashboard` (requires Herdr workspace)             |
| `herdr-project`          | `apply`, `reconcile`, `status` — workspace layout from `dx.config.toml` `[herdr]`                                 |
| `herdr-pane` / `herdr-spawn` | Pane control and agent spawn helpers                                                                          |
| `herdr-doctor`           | Herdr integration health checks                                                                                   |
| `herdr-latm`             | `list`, `sync --project .`, `invoke --tool <name>` — pane capability mesh (auto-routes to shell/reviewer)        |

Further reading: [CODE_REFERENCES.md](CODE_REFERENCES.md), [DEEP-QUALITY.md](DEEP-QUALITY.md), `skills/kimi-toolchain/SKILL.md` (Kimi Code config/MCP/sessions).

---

_Update when adding new tools or changing conventions._
