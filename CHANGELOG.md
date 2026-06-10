# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

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

- Wrapper coverage check now validates all package.json bin entries (not only kimi-*)
- Path-alignment unit tests use system tmpdir (no repo `.tmp-*` pollution)

## [0.1.0] — initial

### Added

- Initial setup
