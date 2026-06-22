# Changelog

All notable changes to this project will be documented in this file.

## 2026-06-20 — Artifact Portal Convergence

**One-liner:** Artifact Portal convergence: shared BenchmarkApiEnvelope, `build:portal`, `examples/portal` demo.

### feat(convergence): Artifact Portal synthesis — BenchmarkApiEnvelope SSOT + polish

**Core:**

- `BenchmarkApiEnvelope` is the shared envelope across `kimi-doctor`, serve-probe (`GET /api/effect-benchmark`), `benchmark.canvas`, Herdr `benchmark-portal`, and Artifact Portal registration (`src/lib/artifact-portal.ts`)
- `bun run build:portal` — probe-first; `--local-only` for offline local loop
- `contracts/artifact-portal.json` + `templates/artifact-portal` + `herdr-plugin/benchmark-portal.ts`
- Runnable `examples/portal/` + `examples/artifact-portal.md`; README and UNIFIED convergence sections
- `kimi-doctor --perf-gates --json` / `--rich` — same envelope as dashboard and serve-probe
- `kimi-doctor --perf-gates --serve-probe` — `GET /api/effect-benchmark` + `POST /api/effect-benchmark/refresh`
- `src/canvases/benchmark.manifest.ts` + `docs/canvases/benchmark.canvas.tsx` — benchmark canvas companion
- `src/lib/benchmark-probe-client.ts` — `fetchBenchmarkProbeEnvelope()` for serve-probe poll
- `bun run test:portal-convergence` — end-to-end portal smoke test
- Perf taxonomy rows: `perf_gate_timeout`, `perf_handler_failure`, `perf_gate_partial`, `rate_limited`

**Polish:**

- `http-client` TLS typing + `bun run fix:drift` (format + typecheck)
- Cursor `wt-match` worktree fallback (`scripts/resolve-repo-root.sh`, `resolveEffectiveWorkspaceRoot`)
- `AGENTS.md` ephemeral worktree note

**Impact:**

One command publishes diagnostics + manifest to `.kimi/artifacts/artifact-portal/` — observable convergence without duplicate benchmark loops. Foundation for dashboard, Herdr, and future portal consumers (Buckeye / MCP / templates next).

**Refs:** `8ce0ea63` (tip), `test:portal-convergence`, `?canvas=benchmark`

**Breaking change:** none — additive APIs and scripts only.

### Stabilization sprint — **done** (2026-06-20)

- `templates/bun-create/artifact-portal-convergence/` — minimal portal workspace; `hooks:install` delegates to `scripts/hooks-portal-install.sh`
- Portal pre-push guard (`scripts/pre-push-portal.sh`) — single pass `build:portal:local:json` + `jq`; no format/lint/repo-wide tests
- `hooks-portal-install.sh` — convergence hook only; strips other hooks; **skipped** inside kimi-toolchain (shared `.git/hooks`)
- `package.json` portal scripts: `build:portal:local`, `build:portal:json`, `build:portal:local:json`, `test:portal-convergence:fast`
- Docs: `examples/artifact-portal.md`, README, UNIFIED — hooks table + fast vs full test split
- Validation: `bun run fix:drift` green; portal tests 12/12; `converged: true` on `build:portal:local:json`

### Unification — **done**

- `src/lib/benchmark-convergence.ts` — `metadata.convergence` on every `BenchmarkApiEnvelope`; manifest `convergedComponents`
- serve-probe `GET /api/effect-benchmark` aggregates dashboard card probe into `dashboardProbe`
- Herdr `benchmark-portal` calls full `buildArtifactPortal()` (parity with `bun run build:portal`)
- `test:portal-convergence` / `test:portal-convergence:fast` — serve-probe mock + optional local-loop integration

## Unreleased

### Added

- `kimi-toolchain workspace fix --deep` — remove legacy Cursor slugs, archive `wd_kimicode-cli_*` sessions, prune `session_index.jsonl`
- Active legacy Cursor slug detection (`isCursorSlugActive`) for audit/cleanup output
- `kimi-toolchain` meta-binary — primary PATH entry; `kimi-*` aliases dispatch through it
- `kimi-doctor workspace verify|audit|fix|cleanup` — consolidated workspace health (replaces `workspace-health-cli.ts`)
- `src/lib/workspace-commands.ts`, `src/lib/tool-registry.ts`

### Changed

- `install-bin-wrappers.sh` installs meta wrapper + dispatch aliases (not 14 direct exec copies)
- `verify-workspace` / `cleanup-legacy` delegate to `kimi-doctor workspace`
- `kimi-governance ecosystem` redirects to `kimi-toolchain doctor --ecosystem`

### Removed

- `src/lib/workspace-health-cli.ts`, `src/lib/path-alignment.ts` (shim)

### Added (prior)

- `scripts/cleanup-legacy-workspace.sh` + `bun run cleanup-legacy` (audit legacy paths; opt-in `--remove-cursor-slugs`)
- Unify runs cleanup-legacy audit after verify-workspace

### Added

- `check:template-policy` gate — 29 audit layers on `templates/**` (install/registry/scaffold/secrets/bootstrap); SSOT `src/lib/template-policy-audit.ts`; wired into `verify:bun-features:strict` and `quality:check:ci`
- `create-template` skill indexed in `REPO_SKILL_CODE_COVERAGE` + `templates/scaffold/skills-readme.md` catalog
- `kimi-new` enforces `bun init -m -y` before `kimi-fix` (greenfield bootstrap bridge)

### Added (prior)

- `scripts/verify-workspace.sh` + `bun run verify-workspace` (unify gate; blocks wrong folder name)
- `kimi-new` / `kimi-fix doctor` smoke tests
- Path-alignment: detect legacy open path when physical path is `kimi-toolchain`

### Added (prior)

- `AGENTS.md` Workspace section — canonical `~/kimi-toolchain` path for agents
- `kimi-toolchain.code-workspace` — Cursor workspace file (open instead of legacy `kimicode-cli`)

### Added (prior)

- `kimi-new` greenfield scaffold CLI (`mkdir` + `bun init -m -y` + `kimi-fix`)
- `kimi-fix doctor` subcommand + scaffold checks in `kimi-doctor`
- `src/lib/scaffold-templates.ts` single source of truth for kimi-fix templates
- `scaffoldAligned` soft gate in kimi-governance (dx.config.toml preflight projects)
- `mergeConfigTomlPermissions` idempotent snippet append (`kimi-doctor --fix`)
- `kimi-fix` scaffolds `AGENTS.md` from `src/lib/scaffold-agents.ts` (uses `package.json` name)
- `TEMPLATES.md` aligned with `kimi-fix` (scripts, bunfig, CI, tsconfig)

### Added (prior)

- Mandatory `bun run sync` in pre-push hook for kimi-toolchain (updates `~/.kimi-code/` manifest on every push)
- `bun run push` script — `git push` then desktop sync (for `--no-verify` recovery)

### Added (prior batch)

- `kimi-config-audit` read-only `config.toml` permission checks in `kimi-doctor` (MCP allow rule + YOLO mode)
- Deeper project `.kimi-code/mcp.json` validation (stub, unified-shell override)
- Kimi Code 0.12+ version matrix updates (`sub-skills` stable, 0.14.0 upgrade hint)

### Added (prior)

- MCP auto-provisioning: `src/lib/mcp-config.ts` seeds `unified-shell` in `~/.kimi-code/mcp.json` on sync/postinstall
- `kimi-doctor` MCP validation section and official `kimi doctor` delegation
- Dual skill sync to `~/.kimi-code/skills/` and `~/.agents/skills/`
- Path alignment: session cwd, ACP command hints, Cursor workspace drift warnings
- `kimi-fix` scaffolds `.kimi-code/mcp.json` and `.kimi-code/skills/`
- Kimi Code alignment docs in UNIFIED.md, SKILL.md, TEMPLATES.md (MCP, ACP, editors)
- `kimiDocsAligned` soft gate in kimi-governance (doctor + score informational line)
- `unified-shell-bridge` package.json bin entry and PATH wrapper

### Fixed

- `kimi-fix` delegated tools now run with `cwd: project` (governance/context/guardian/hooks)
- `getProjectName` prefers `package.json` `name` over directory basename (AGENTS.md, README, etc.)
- Wrapper coverage check now validates all package.json bin entries (not only kimi-*)
- Path-alignment unit tests use system tmpdir (no repo `.tmp-*` pollution)

## [0.1.0] — initial

### Added

- Initial setup
