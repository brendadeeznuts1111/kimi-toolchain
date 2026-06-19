# kimi-toolchain — Agent Guide

> Bun-native developer tooling: governance, diagnostics, security, and scaffolding.
> This file is for AI coding agents. It assumes zero prior knowledge of the project.

## Workspace (read first)

| Rule                     | Value                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Canonical clone path** | `~/kimi-toolchain`                                                                  |
| **Folder name**          | Must be `kimi-toolchain` (matches `package.json` `name`)                            |
| **Legacy path**          | `~/kimicode-cli` — **do not use** (renamed; breaks tool path resolution)            |
| **Cursor**               | File → Open Folder → `~/kimi-toolchain` (not `$HOME`, not symlink)                  |
| **Repo root**            | Use `git rev-parse --show-toplevel` or workspace root — never assume `kimicode-cli` |

If Grep/Glob fail with `Path does not exist: .../kimicode-cli`, the editor opened the wrong folder. Reopen `~/kimi-toolchain`.

**Before writing code:**

1. Read `/Users/nolarose/.config/dx/AGENTS.md` for the global DX layer.
2. Run `dx context`, `dx config`, `dx mcp-status`, or `dx mcp-doctor` when the task touches global setup, MCP, package, or shell behavior.
3. Read `./CODE_REFERENCES.md`, pick the closest existing pattern, and preserve local conventions before editing.
4. Cloudflare SSO/OAuth is separate from Wrangler OAuth and `kimi-cloudflare-access` API tokens; do not assume one login satisfies another.
5. Keep Success Metrics green: Drift latency, Error coverage, and Integration agility are checked by `kimi-doctor --success-metrics`.

**Agent Operating Loop (15% quality lift target):**

| Step          | Agent action                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------- |
| **Scope**     | Classify the change, read the matching `CODE_REFERENCES.md` row, and name the smallest slice. |
| **Implement** | Follow the closest local pattern; keep parsing, mutation, and subprocess boundaries typed.    |
| **Guard**     | Add or update a detector/test for any behavior that failed or could silently drift.           |
| **Validate**  | Run the narrow test first, then `bun run check:fast`; use `bun run check` before handoff.     |
| **Sync**      | Run `bun run sync && bun run sync:verify` after changing synced tools, docs, or skills.       |

**After reopen checklist:**

1. `pwd` ends with `kimi-toolchain`
2. `kimi-toolchain workspace verify` (or `bun run verify-workspace`)
3. `kimi-toolchain workspace cleanup` — audit legacy Cursor slugs (no delete by default)
4. If slug persists: `kimi-toolchain workspace fix --deep` then **quit Cursor fully** and reopen `kimi-toolchain.code-workspace`
5. Full cross-product check: `kimi-toolchain doctor --ecosystem --quick --json`

**Primary entry:** `kimi-toolchain <tool> [args]` — legacy `kimi-*` commands dispatch through it. See [UNIFIED.md](UNIFIED.md) for the path map.

## Project Overview

`kimi-toolchain` is a Bun-native CLI toolkit that provides project health checks, supply-chain security, governance scoring, session memory, git hooks, scaffolding automation, and introspection/self-healing over local failures. It is a meta-project: the tools manage other projects.

- **Repository**: `https://github.com/brendadeeznuts1111/kimi-toolchain`
- **License**: MIT
- **Language**: TypeScript (ESNext, strict mode)
- **Runtime**: Bun >= 1.3.14
- **Minimal runtime dependencies** — `effect` and `js-yaml`; everything else uses Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.spawn`, etc.)

## Architecture

### Repo Layout

```
kimi-toolchain/
  src/
    bin/                    # CLI entry points (16 registered bins)
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
      ├── kimi-trace.ts           # Causal trace graph reconstruction
      ├── kimi-capabilities.ts    # Live integration health probing
      ├── kimi-contract.ts        # Signed contract trust validation
      ├── kimi-decision.ts        # Decision ledger list/why/record CLI
      ├── kimi-heal.ts            # Failure clustering + self-healing plan
      ├── kimi-why.ts             # Decision ledger alias
      └── unified-shell-bridge.ts # MCP stdio server for shell execution
    lib/
      ├── utils.ts          # Shared utilities (fs, hash, logging, runTool)
      ├── trace-ledger.ts   # Append-only trace event graph
      ├── capabilities.ts   # Capability probe protocol + snapshots
      ├── contract-signing.ts # Ed25519 contract signing/validation
      ├── error-clustering.ts # Semantic-ish local failure clustering
      ├── self-healing.ts   # HealPlan schema + guarded apply
      ├── decision-ledger.ts # Append-only "why" decisions
      └── version.ts        # Canonical version (reads package.json)
    install-hooks/
      └── postinstall.ts    # Idempotent ~/.kimi-code/ setup (bun package hook)
    kimi-hooks/
      └── log-tool-failure.ts  # Kimi Code PostToolUseFailure hook script
    git-hooks/              # Git hook templates (installed by kimi-githooks)
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
  scripts/            # Copies of scripts/*.ts
  mcp.json            # User MCP config (postinstall seeds unified-shell)
  skills/             # Kimi Code skills (incl. kimi-toolchain copy)
  var/                # Toolchain state (sessions.db — not Kimi sessions/)
  var/tool-failures.jsonl  # Classified failures with trace context
  var/trace-events.jsonl   # Causal trace events
  var/decision-ledger.jsonl # Recorded decisions for kimi-decision / kimi-why
  var/capabilities/        # Capability snapshots over time
  guardian/           # Lockfile manifest DB
  governor/           # Resource governor DB + cache
  AGENTS.md           # Copied from repo root
  CODE_REFERENCES.md  # Copied from repo root
  UNIFIED.md          # Copied from repo root
  TEMPLATES.md        # Copied from repo root
```

**Do not edit `~/.kimi-code/` manually.** Use `bun run sync` (or `bun run sync:daemon`) to push repo changes to the live runtime. Sync regenerates `~/.kimi-code/toolchain-manifest.json`; pre-push also runs `bun run sync:verify` to block stale hashes or desktop drift.

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

## Success Metrics

These contracts describe what “better code by future agents” means in this repo.
Run `kimi-doctor --success-metrics` for a single pass/fail view; `bun run check`
also runs the same audit.

| Metric                  | Required default                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drift latency**       | Documented commands, samples, and help examples must be checkable in one `kimi doctor` or `kimi-doctor` run without manual inspection.            |
| **Error coverage**      | >= 90% of managed contract, hook, and integration failures must get a taxonomy code plus structured stack, input, environment, and trace context. |
| **Integration agility** | New cloud providers are represented by only two artifacts: a contract declaration and a thin `getSecret(scope) -> string` credential adapter.     |

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

## Build & Test Commands

All commands are run from the repo root.

```bash
# Install dependencies
bun install

# Run the full test suite (unit + smoke; default 5s per-test timeout)
bun test

# Fast unit-only gate (uses the repo fast timeout)
bun run test:fast
bun run check:fast       # format + lint + typecheck + test:fast

# Preview CI gates without running them
bun run check:dry-run    # accepts --dryrun alias (gate steps only)
# CI test profile (60s timeout, coverage, lcov, junit, --bail)
bun run test:coverage:ci
bun run format:check:ci   # oxfmt --threads=4 for CI runners

# Full quality gate (CI / explicit local validation)
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
bun run sync             # one-shot (mandatory on every pre-push in this repo)
bun run sync:manifest    # regenerate ~/.kimi-code/toolchain-manifest.json
bun run sync:verify      # verify manifest hashes + desktop drift
bun run sync:daemon      # Bun.cron every 5 minutes
bun run push             # git push + sync (use if hooks were skipped)
bun run verify-workspace # fail if cwd folder is not kimi-toolchain
bun run cleanup-legacy   # audit legacy kimicode-cli paths + Cursor slugs
```

Generated test homes, JUnit reports, coverage output, and disposable temp files must go under `.kimi-artifacts/`. That directory is ignored; do not create new root-level `coverage/`, `reports/`, or `.tmp-*` outputs.

### Global Install (for end users)

```bash
bun install -g github:brendadeeznuts1111/kimi-toolchain
```

After global install, all `kimi-*` binaries are available on PATH.

## Code Organization

### Path Helpers (src/lib/paths.ts)

All paths under `~/.kimi-code/` must use `src/lib/paths.ts` helpers. **Never hardcode `~/.kimi-code` or `~/.kimi-code/...` strings in source.**

| Helper                    | Returns                                | Example                      |
| ------------------------- | -------------------------------------- | ---------------------------- |
| `homeDir()`               | `$HOME` or `/tmp`                      | `/Users/nolarose`            |
| `desktopRoot()`           | `~/.kimi-code`                         | `/Users/nolarose/.kimi-code` |
| `toolsDir()`              | `~/.kimi-code/tools`                   | ...                          |
| `libDir()`                | `~/.kimi-code/lib`                     | ...                          |
| `scriptsDir()`            | `~/.kimi-code/scripts`                 | ...                          |
| `mcpPath()`               | `~/.kimi-code/mcp.json`                | ...                          |
| `skillsDir()`             | `~/.kimi-code/skills`                  | ...                          |
| `varDir()`                | `~/.kimi-code/var`                     | ...                          |
| `guardDir()`              | `~/.kimi-code/guardian`                | ...                          |
| `governorDir()`           | `~/.kimi-code/governor`                | ...                          |
| `snapshotDir()`           | `~/.kimi-code/snapshots`               | ...                          |
| `agentsSkillsRoot()`      | `~/.agents/skills`                     | ...                          |
| `taxonomyPath()`          | `~/.kimi-code/error-taxonomy.yml`      | ...                          |
| `toolchainManifestPath()` | `~/.kimi-code/toolchain-manifest.json` | ...                          |

Import: `import { desktopRoot, toolsDir } from "../lib/paths.ts";` (adjust depth as needed).

### Safe Parse Helpers (src/lib/utils.ts)

| Helper                                     | Purpose                | Fallback on failure |
| ------------------------------------------ | ---------------------- | ------------------- |
| `safeParse<T>(json, fallback, validator?)` | Typed `JSON.parse`     | Returns `fallback`  |
| `safeToml<T>(text, fallback, validate?)`   | Typed `Bun.TOML.parse` | Returns `fallback`  |

Use these instead of unchecked `JSON.parse(...)` as `any` or `TOML.parse(...)` as `any` casts. The optional `validator` parameter accepts a type guard for runtime shape validation.

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

### Hooks taxonomy

The project uses three separate hook systems. Do not conflate them in docs or code.

| System                        | Location                                                                      | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Git hooks**                 | Installed into `.git/hooks/` by `kimi-githooks`                               | `pre-commit`, `pre-push` policy gates                                   |
| **Bun install hook**          | `src/install-hooks/postinstall.ts`                                            | Idempotent `~/.kimi-code/` setup after `bun install`                    |
| **Kimi Code lifecycle hooks** | `src/kimi-hooks/` scripts; declared in `~/.kimi-code/config.toml` `[[hooks]]` | Intercept `PreToolUse`, audit `PostToolUseFailure`, notifications, etc. |

#### Install hooks (`src/install-hooks/`)

- **`postinstall.ts`** — Creates `~/.kimi-code/` directory tree, copies tools/lib/templates, initializes `sessions.db` schema, installs the agent skill to `~/.agents/skills/kimi-toolchain/`.

#### Kimi Code hooks (`src/kimi-hooks/`)

- **`log-tool-failure.ts`** — `PostToolUseFailure` handler. Reads JSON from stdin, normalizes string/object errors without losing evidence, classifies the failure against `~/.kimi-code/error-taxonomy.yml`, and appends to `~/.kimi-code/var/tool-failures.jsonl`.
- **`kimi-debug taxonomy`** — List all categories from `~/.kimi-code/error-taxonomy.yml`.
- **`kimi-debug wire [path]`** — Parse a `wire.jsonl` and summarize failures by category.
- **Canonical failure ledger**: `~/.kimi-code/var/tool-failures.jsonl`. Records include `schemaVersion`, `taxonomyId`, `traceId`, `parentTraceId`, `childTraceIds`, and structured `context.inputs` / `context.environment` where available.
- **Canonical trace ledger**: `~/.kimi-code/var/trace-events.jsonl`. Records include `schemaVersion`, `traceId`, `parentTraceId`, `eventType`, timing, status, and optional metadata.

## Testing Strategy

- **Test runner**: `bun:test` (built into Bun)
- **Test files**: unit tests under `test/`, Effect tests under `test/effect/`, smoke tests in `test/smoke/kimi-doctor.smoke.test.ts`
- **Test style**: Unit tests for pure logic and typed errors; smoke tests spawn CLI tools and assert on stdout + exit code.
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

| Layer      | Command / hook                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | `bun run check` or `bun run unify`                                                                                                                       |
| pre-commit | `format:check` + `lint` + `typecheck` (via `kimi-githooks install`)                                                                                      |
| pre-push   | skips no-op/delete-only pushes; otherwise guardian + R-Score + `check:fast` + mandatory `bun run sync` + `sync:verify` (`KIMI_PRE_PUSH_FULL=1` for full) |
| CI         | `.github/workflows/ci.yml` — format:check, lint, typecheck, test                                                                                         |
| Doctor     | `kimi-doctor` Code Quality section (runs gates unless `--quick`)                                                                                         |

Install hooks: `kimi-githooks install` or `kimi-githooks fix` to refresh outdated hooks.

### Linting & Formatting Strategy

| Tool             | Role       | Why                                                                     |
| ---------------- | ---------- | ----------------------------------------------------------------------- |
| **oxfmt**        | Formatter  | 30x faster than Prettier, same output. Alpha but stable for this repo.  |
| **oxlint**       | Linter     | 50-100x faster than ESLint, 655+ rules, native TS support, zero-config. |
| **tsc --noEmit** | Type check | Catches type-aware issues that oxlint (without `--type-aware`) misses.  |

**Do not add ESLint.** The project keeps runtime dependencies minimal and avoids plugin ecosystems. Oxlint's built-in rules + `tsc --noEmit` cover all needs. When `oxlint --type-aware` (via tsgolint) stabilizes, evaluate adding it for `no-floating-promises` and similar rules.

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

### Tool Invocation & Logging Standards

Use the shared tool runner and logger for cross-tool calls instead of open-coded subprocess/logging behavior.
See [CODE_REFERENCES.md](CODE_REFERENCES.md) for the local exemplar map future agents should follow before writing new modules.

| Need                            | Use                                                | Avoid                                                     |
| ------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Invoke another toolchain CLI    | `invokeTool()` / `runTool()` from `tool-runner.ts` | Raw `Bun.spawn(["bun", "run", ...])` in feature code      |
| Invoke from Effect code         | `invokeToolEffect()` / `runToolEffect()`           | Converting every error to an untyped string               |
| Emit CLI status                 | `createLogger(Bun.argv, toolName)`                 | Raw `console.log` for doctor/check output                 |
| Emit structured health results  | `logger.check()` / `logger.printHealthReport()`    | Ad hoc JSON shapes                                        |
| Persist agent/session telemetry | `logger.flushToFile()`                             | Writing unrelated files under `~/.kimi-code/var/`         |
| Long or noisy subprocess output | `maxOutputBytes` on `invokeTool()`                 | Unbounded `Bun.readableStreamToText(proc.stdout)` capture |
| Child environment changes       | `env` overlay on `invokeTool()`                    | Mutating `Bun.env` for a subprocess                       |

Runner defaults:

- `invokeTool()` uses `Bun.cwd`, a 30s human timeout, a 15s agent/CI timeout, 5s SIGTERM-to-SIGKILL grace, and 1 MiB retained output per stream.
- `stdoutTruncated` / `stderrTruncated` mark clipped output. Preserve those fields in higher-level reports when relevant.
- If a command needs live streaming UX, keep the tool-runner contract and stream the returned output at the router boundary.
- JSON mode must emit `schemaVersion`, `tool`, `level`, `message`, and `timestamp`; do not invent one-off machine-readable formats for new doctors.

### Reference Code Before Writing

Agents should choose the closest existing implementation and match it before creating new patterns.

| New work                        | Read first                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| New CLI main                    | `src/lib/effect/cli-runtime.ts`, `src/bin/kimi-toolchain.ts`                                    |
| New cross-tool call             | `src/lib/tool-runner.ts`, `src/lib/effect/tool-runner-effect.ts`                                |
| New doctor/check output         | `src/lib/logger.ts`, `src/lib/health-check.ts`, `src/lib/doctor-pipeline.ts`                    |
| New introspection surface       | `src/lib/trace-ledger.ts`, `src/lib/capabilities.ts`, `src/lib/error-clustering.ts`             |
| New self-healing action         | `src/lib/self-healing.ts`, `src/bin/kimi-heal.ts`, `test/self-healing.unit.test.ts`             |
| New signed contract behavior    | `src/lib/contract-signing.ts`, `src/bin/kimi-contract.ts`, `test/contract-signing.unit.test.ts` |
| New config or schema parser     | `src/lib/cloudflare-access-policy.ts`, `src/lib/mcp-config.ts`, `src/lib/kimi-config-audit.ts`  |
| New package/dependency behavior | `package.json`, `bunfig.toml`, `src/lib/scaffold-quality.ts`, `kimi-guardian check`             |
| New scaffold/agent docs         | `src/lib/scaffold-agents.ts`, `TEMPLATES.md`, `test/scaffold-agents.unit.test.ts`               |

### Introspection onboarding

When a future agent needs current toolchain state, start with the purpose-built surfaces before reading raw ledgers. Use `kimi-capabilities --json` to check live MCP, hook, credential, and contract readiness. Use `kimi-trace <trace-id> --json` to reconstruct nested subprocess, hook, or MCP failure chains and inspect `rootCauseChain`. Use `kimi-contract validate --json` before trusting changed declarations or provider contracts. Use `kimi-heal plan --json` to surface safe/manual/blocked repairs, and only run `kimi-heal apply --yes` for actions marked `safeToAutoApply`.

### Process Cache (src/lib/process-utils.ts, src/lib/memory-budget.ts)

Both modules share a lightweight TTL cache for `ps` output to avoid repeated system calls within the same doctor run:

- **Cache TTL**: 1000ms (1 second)
- **Clear cache**: `clearProcessCache()` from either module
- **Why**: `ps aux` / `ps -axo` calls take ~30-140ms each; a typical doctor run calls them 3-5 times. Caching reduces this to a single call.
- **Benchmark improvement**: `getOrphanProcesses` from ~108ms → ~0.3ms (cached); `getAppRssGroups` + `getChromeRssMB` from ~70ms → ~1.3ms (shared call).

### src/lib/ Flat Structure

`src/lib/` is flat by default to avoid deep import paths and circular dependencies. `src/lib/effect/` is the intentional exception for Effect adapters and typed CLI/runtime errors. New subdirectories need an explicit rationale in `src/lib/README.md`.

**Import rule**: Use relative paths (`../lib/foo.ts`) — never absolute or path aliases.

### Benchmarking

Run `bun run bench` to execute `bench/core.bench.ts`. Add new benchmarks when introducing performance-critical paths. The suite uses `Bun.nanoseconds()` for high-resolution timing.

| Benchmark                     | Baseline | Target    |
| ----------------------------- | -------- | --------- |
| `sha256String (1KB)`          | ~0.001ms | < 0.01ms  |
| `safeParse (small object)`    | ~0.000ms | < 0.001ms |
| `computeRScore (full)`        | ~0.001ms | < 0.01ms  |
| `getOrphanProcesses (cold)`   | ~140ms   | < 200ms   |
| `getOrphanProcesses (cached)` | ~0.3ms   | < 1ms     |
| `getAppRssGroups+cachedRss`   | ~1.3ms   | < 5ms     |

- `process.on("SIGINT", handler)` is acceptable.
- `process.exit(code)` is acceptable for CLI tools.
- For resource-limited spawning, use `governedSpawn()` from `kimi-resource-governor.ts`.

### Agent Defaults & Recommendations

When working on this codebase, agents should:

| Setting              | Recommendation                                                           | Why                                                       |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Permission mode**  | `auto` for safe paths (tests, docs), `manual` for destructive ops        | Prevents accidental deletes while allowing fast iteration |
| **Background tasks** | Keep `keep_alive_on_exit = false` unless explicitly daemonizing          | Avoids orphan processes                                   |
| **Loop control**     | `max_steps_per_turn` is **unset** in `config.toml` (unlimited)           | Context compaction + step-budget discipline handle memory |
| **MCP timeout**      | Default 30s is sufficient; increase only for long-running Cloudflare ops | Most tools complete in < 5s                               |
| **Session memory**   | Use `kimi-memory store` for cross-session context, not file hacks        | Proper SQLite persistence                                 |

> **Note on step limits:** The live `~/.kimi-code/config.toml` has `max_steps_per_turn` commented out (unlimited). If your local config still has it set to 30, run `kimi-doctor --fix` to align with the recommended defaults. The toolchain now auto-detects agent context and reduces tool timeouts to 15s.

**Before starting a long session:**

1. Run `kimi-doctor --agent-ready` to check shell, PATH, official Kimi Code config, MCP config, and memory readiness
2. Run `kimi-doctor --quick` when you need the broader diagnostics view
3. Run `kimi-orphan-kill --dry-run` if orphans detected
4. Ensure R-Score is ≥ B (run `kimi-governance score`)

**During a session (step-budget discipline):**

| Instead of                                                    | Use                                                          | Why                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `bun test` (all ~315 tests, ~15s)                             | `bun run test:fast` (~292 unit tests, ~2s)                   | Smoke tests are subprocess-heavy and not needed for most edits |
| `bun run check` (4 gates, ~30s)                               | `bun run check:fast` (fast mode, ~3s)                        | Runs only unit tests with 500ms timeout                        |
| `bun run format` then `bun run lint` then `bun run typecheck` | `bun run check:fast`                                         | Bundles all three; agents should not run them separately       |
| Re-running full suite after every edit                        | Target specific test files: `bun test test/lib.unit.test.ts` | 1-2 steps instead of 5-10                                      |
| `bun run bench` (benchmarks)                                  | Only run when optimizing performance                         | Benchmarks are for regression detection, not validation        |
| Running `kimi-doctor` without `--quick`                       | `kimi-doctor --quick`                                        | Full doctor runs 10 parallel tools with 120s timeouts each     |
| Running `kimi-debug wire` without path                        | `kimi-debug wire` (now auto-discovers latest session)        | Previously hardcoded to a stale session                        |

**Agent workflow for validation (batching strategy):**

1. **Batch all edits first** (1 step per file, up to 5-8 files)
2. Run `bun run check:fast` (1 step, ~2-3s)
3. If failures: read the specific failing test file (1 step), read source (1 step), edit (1 step)
4. Re-run `bun run check:fast` (1 step)
5. **Total: 4-6 steps per iteration**
6. After 3-4 iterations or when confident, run `bun run check` (full validation, 1 step)

**Regression hygiene after fixing a tooling mistake:**

- Add a typed detector or gate for the behavior that failed, not just a one-off fix.
- Search for the same pattern in CI config, generated scaffolds, README, AGENTS.md, skills, and test gate lists.
- Test files must declare their class in the filename: `.unit.test.ts`, `.integration.test.ts`, or `.smoke.test.ts`. `test/test-gates.unit.test.ts` enforces this and requires every classified test to appear in the matching gate list.
- Git rename helpers can stage changes. After any `git mv` or other index-touching operation, run `git diff --cached --stat`; unstage with `git restore --staged ...` unless the user asked to stage/commit.
- When searching for text containing backticks, `$()`, pipes, or other shell metacharacters, use single-quoted patterns or `rg -e` arguments so the shell cannot execute the search text.

> **Recovery if you hit `max_steps_exceeded`:**
>
> 1. Run `kimi-debug analyze "max_steps_exceeded"` for immediate guidance
> 2. Switch to `bun run check:fast` instead of full suite
> 3. Batch remaining edits without running tests between each one
> 4. Run only targeted tests: `bun test <specific-file>`

**After finishing a session:**

1. Run `kimi-githooks doctor`
2. Run `bun run check:fast` during iteration, then `bun run check` before commit
3. Run `kimi-doctor --agent-ready`
4. Run `kimi-guardian check` and `kimi-governance score`
5. Commit with conventional commit format
6. Run `bun run sync && bun run sync:verify` before push if hooks were skipped; the managed pre-push hook enforces this for real ref updates

### Step Budget Reference

| Step Range | Action Pattern                                |
| ---------- | --------------------------------------------- |
| 1-2        | Batch edits for 1 file                        |
| 3-4        | Run `check:fast` + read failure               |
| 5-6        | Read source + edit + re-run                   |
| 7-10       | Multi-file refactor batch                     |
| 11-15      | Full `bun run check` + commit                 |
| 16+        | Reserve for complex validation or smoke tests |

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
- **Files included in package**: `src/`, `scripts/`, `ci/`, `contracts/`, `docs/`, `skills/`, `templates/`, `AGENTS.md`, `CODE_REFERENCES.md`, `UNIFIED.md`, `TEMPLATES.md`, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `CHANGELOG.md`.

## Key Files for Agents

| File                                            | Purpose                                             |
| ----------------------------------------------- | --------------------------------------------------- |
| `package.json`                                  | Toolchain metadata, bin mappings, scripts           |
| `tsconfig.json`                                 | Strict TypeScript, ESNext, bundler resolution       |
| `bunfig.toml`                                   | Bun install config (`saveTextLockfile = true`)      |
| `src/lib/utils.ts`                              | Shared utilities — import from here                 |
| `src/lib/version.ts`                            | Version resolution logic                            |
| `src/lib/memory-budget.ts`                      | System memory / RSS budget checks                   |
| `src/lib/governor-config.ts`                    | Loads `~/.kimi-code/governor/defaults.toml`         |
| `src/lib/test-gates.ts`                         | Unit vs smoke test lists, `bunTestArgs()`           |
| `src/lib/agent-context-quality.ts`              | Agent docs, skill, scaffold, and guardrail score    |
| `src/lib/effect/kimi-introspection-services.ts` | Effect services for capabilities, trace, contracts  |
| `src/lib/readme-sync.ts`                        | README ↔ package.json drift detect + patch          |
| `src/lib/artifacts.ts`                          | Repo-local generated artifact paths                 |
| `src/lib/sync-manifest.ts`                      | Sync manifest generation + stale hash verification  |
| `src/lib/paths.ts`                              | **Single source of truth for `~/.kimi-code` paths** |
| `src/lib/governance-check.ts`                   | License/CONTRIBUTING/CODEOWNERS checker             |
| `src/lib/r-score.ts`                            | R-Score calculation + grade formatting              |
| `src/lib/conventional-commits.ts`               | Conventional commit parser + semver bump logic      |
| `src/lib/changelog.ts`                          | Changelog section generation + update               |
| `src/lib/scaffold-templates.ts`                 | README, LICENSE, ADR template generators            |
| `src/lib/scaffold-quality.ts`                   | package.json quality tooling injection              |
| `src/lib/process-utils.ts`                      | Orphan process detection + cleanup                  |
| `src/lib/trace-ledger.ts`                       | Causal trace event schema + graph rendering         |
| `src/lib/capabilities.ts`                       | Live capability probe schema + snapshots            |
| `src/lib/contract-signing.ts`                   | Ed25519 contract signature schema + trust audit     |
| `src/lib/error-clustering.ts`                   | Failure clustering report schema                    |
| `src/lib/self-healing.ts`                       | HealPlan / HealApplyReport schema and safe apply    |
| `src/lib/decision-ledger.ts`                    | Append-only decision records and `DecisionLogger`   |
| `scripts/check.ts`                              | CI gate runner with dry-run and fast modes          |
| `test/kimi-doctor.smoke.test.ts`                | Smoke tests for all tools                           |
| `CONTEXT.md`                                    | Auto-generated project context                      |
| `CODE_REFERENCES.md`                            | Local exemplar map for agent coding patterns        |
| `skills/kimi-toolchain/SKILL.md`                | Agent decision protocol                             |
| `error-taxonomy.yml`                            | Failure classification schema                       |
| `~/.kimi-code/var/tool-failures.jsonl`          | Canonical tool failure ledger                       |
| `~/.kimi-code/var/trace-events.jsonl`           | Canonical causal trace ledger                       |
| `~/.kimi-code/var/decision-ledger.jsonl`        | Canonical decision ledger                           |
| `trusted-keys.json`                             | Project trusted public keys for signed contracts    |

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
| `kimi-cloudflare-access` | `login`, `logout`, `tokens`, `apps`, `doctor`, `fix` (token expiry, app policy audit)                             |
| `kimi-context-gen`       | `scan`, `update`, `freshness`, `doctor`, `fix [threshold]`                                                        |
| `kimi-release`           | `changelog`, `semver`, `validate`, `doctor`, `fix`                                                                |
| `kimi-debug`             | `last`, `diff`, `trace`, `analyze`, `classify`, `taxonomy`, `wire [path]`, `doctor`, `fix`                        |
| `kimi-snapshot`          | `save`, `restore`, `list`, `show`, `cleanup`, `doctor`, `fix`                                                     |
| `kimi-resource-governor` | `limits`, `parallel`, `quota`, `cache`, `spawn`, `session`, `cleanup`, `status`, `doctor`, `fix`                  |
| `kimi-trace`             | `<trace-id>`, `--json`                                                                                            |
| `kimi-capabilities`      | `--json`, `--trend`                                                                                               |
| `kimi-contract`          | `sign <contract-file>`, `validate [contract-file or --all]`, `--json`, `--strict`                                 |
| `kimi-heal`              | `plan`, `apply --dry-run`, `apply --yes --action <id>`, `clusters`, `match`                                       |
| `kimi-decision`          | `log`, `why <decision-id>`, `record`, filters, `--json`                                                           |
| `kimi-why`               | `<decision-id\|topic>`, `list`, `record`, `--json`                                                                |

---

## Kimi Code Official Documentation

When toolchain behavior depends on Kimi Code internals (loop limits, permissions, MCP wiring), consult the authoritative docs rather than inferring from behavior.

| Topic                                                           | URL                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Config files (`loop_control`, `permission`, `background`, etc.) | `https://moonshotai.github.io/kimi-code/en/configuration/config-files.html`         |
| Providers & models                                              | `https://moonshotai.github.io/kimi-code/en/configuration/providers-and-models.html` |
| MCP configuration                                               | `https://moonshotai.github.io/kimi-code/en/customization/mcp.html`                  |
| ACP (IDE integration)                                           | `https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.html`                 |
| Source repo                                                     | `https://github.com/MoonshotAI/kimi-code`                                           |

**Agent-relevant config defaults** (from official docs, verified 2026-06-12):

| Section        | Key                       | Default               | Meaning                                                          |
| -------------- | ------------------------- | --------------------- | ---------------------------------------------------------------- |
| `loop_control` | `max_steps_per_turn`      | — (unset = unlimited) | Hard cap on steps per turn                                       |
| `loop_control` | `max_retries_per_step`    | `3`                   | Auto-retry failed steps                                          |
| `loop_control` | `reserved_context_size`   | —                     | Trigger context compaction when remaining tokens fall below this |
| `permission`   | `default_permission_mode` | `manual`              | `manual` / `auto` / `yolo`                                       |
| `background`   | `max_running_tasks`       | —                     | Concurrent background task limit                                 |
| `background`   | `keep_alive_on_exit`      | `false`               | Persist background tasks after session close                     |

> **Environment override:** `KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT` takes priority over `config.toml`.

> **Important:** MCP server declarations go in `~/.kimi-code/mcp.json` (or project-local `.kimi-code/mcp.json`), NOT in `config.toml`. The `[mcp]` section in some legacy configs may be non-standard.

### Non-standard config fields (toolchain audit)

The following fields were found in our `~/.kimi-code/config.toml` but are **not documented** in the official Kimi Code docs. They have been commented out and replaced with standard equivalents:

| Field                               | Was in           | Standard replacement                        | Status        |
| ----------------------------------- | ---------------- | ------------------------------------------- | ------------- |
| `[mcp] allow`                       | `config.toml`    | `[[permission.rules]] pattern = "mcp__..."` | Migrated      |
| `[mcp.client] tool_call_timeout_ms` | `config.toml`    | None — not supported                        | Commented out |
| `[safety] auto_approve_destructive` | `config.toml`    | `default_permission_mode = "manual"`        | Commented out |
| `max_ralph_iterations`              | `[loop_control]` | None — toolchain custom                     | Commented out |

**Agent rule:** Never add toolchain-specific keys to `config.toml`. Use `~/.kimi-code/toolchain-manifest.json`, `~/.kimi-code/governor/defaults.toml`, or a custom file under `~/.kimi-code/` instead. `config.toml` is owned by Kimi Code and non-standard keys are silently ignored.

---

_Generated from project source. Update when adding new tools or changing conventions._
