# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- **Artifact Portal convergence** — Canvas, Dashboard, Herdr, and CLI share `BenchmarkApiEnvelope` via `runEffectBenchmarkCardLoop()` (commits `914b9195`–`bdccb421`)
- `kimi-doctor --perf-gates --json` / `--rich` — same envelope as examples dashboard and serve-probe
- `kimi-doctor --perf-gates --serve-probe` — `GET /api/effect-benchmark` + `POST /api/effect-benchmark/refresh`
- `src/canvases/benchmark.manifest.ts` + `docs/canvases/benchmark.canvas.tsx` — benchmark canvas companion (read order 13)
- `src/lib/benchmark-probe-client.ts` — `fetchBenchmarkProbeEnvelope()` for serve-probe poll
- `src/lib/artifact-portal.ts` — `registerPortalArtifact()`, `pullBenchmarkEnvelopeAndRegister()`, `buildArtifactPortal()`
- `contracts/artifact-portal.json` — portal diagnostics contract
- `herdr-plugin/benchmark-portal` action — pull probe envelope and register portal artifact
- `bun run build:portal` — one-command publish to `.kimi/artifacts/artifact-portal/` (serve-probe first, `--local-only` fallback)
- `bun run test:portal-convergence` — end-to-end portal smoke test
- Perf taxonomy rows: `perf_gate_timeout`, `perf_handler_failure`, `perf_gate_partial`, `rate_limited`

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

### Added (prior)

- `scripts/verify-workspace.sh` + `bun run verify-workspace` (unify gate; blocks wrong folder name)
- `kimi-new` / `kimi-fix doctor` smoke tests
- Path-alignment: detect legacy open path when physical path is `kimi-toolchain`

### Added (prior)

- `AGENTS.md` Workspace section — canonical `~/kimi-toolchain` path for agents
- `kimi-toolchain.code-workspace` — Cursor workspace file (open instead of legacy `kimicode-cli`)

### Added (prior)

- `kimi-new` greenfield scaffold CLI (`mkdir` + `bun init` + `kimi-fix`)
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
