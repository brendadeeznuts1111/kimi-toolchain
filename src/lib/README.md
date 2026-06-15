# src/lib/ — Domain Guide

This directory contains 43 shared modules used by CLI tools and tests.
The flat structure is intentional — all modules are at the same level
to avoid deep import paths and circular dependency issues.

## Domains

| Domain         | Files                                                                                                             | Purpose                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Core**       | `utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`                                                            | Shared utilities, version resolution, path helpers, tool execution |
| **Governance** | `r-score.ts`, `governance-check.ts`, `readme-sync.ts`                                                             | R-Score calculation, license/CONTRIBUTING checker, README drift    |
| **Scaffold**   | `scaffold-templates.ts`, `scaffold-agents.ts`, `scaffold-aligned.ts`, `scaffold-doctor.ts`, `scaffold-quality.ts` | Template generation, AGENTS.md builder, alignment checks           |
| **Cloudflare** | `cloudflare-access.ts`, `cloudflare-access-policy.ts`                                                             | Cloudflare Access API, policy diff/plan/apply                      |
| **Governor**   | `governor-*.ts` (6 files)                                                                                         | Resource limits, parallelism, disk quota, diagnostic cache         |
| **Memory**     | `memory-budget.ts`, `memory-sessions.ts`, `sessions-schema.ts`                                                    | System memory checks, session store, DB schema                     |
| **Git**        | `git-helpers.ts`, `conventional-commits.ts`, `changelog.ts`                                                       | Git operations, conventional commit parsing, changelog generation  |
| **Config**     | `mcp-config.ts`, `kimi-config-audit.ts`, `test-gates.ts`                                                          | MCP configuration, Kimi config audit, test gate configs            |
| **Health**     | `workspace-health.ts`, `workspace-commands.ts`, `legacy-cleanup.ts`, `ecosystem-health.ts`                        | Workspace health, commands, legacy cleanup, ecosystem checks       |
| **Process**    | `process-utils.ts`, `snapshot-core.ts`                                                                            | Orphan process detection, snapshot management                      |
| **Doctor**     | `doctor-runs.ts`                                                                                                  | Doctor run persistence                                             |
| **Sync**       | `desktop-sync.ts`, `sync-hashes.ts`                                                                               | Desktop sync, hash verification                                    |
| **Registry**   | `tool-registry.ts`                                                                                                | Tool registry                                                      |
| **Taxonomy**   | `error-taxonomy.ts`                                                                                               | Error taxonomy                                                     |

## Import Rules

- Import from `src/lib/` using relative paths: `import { ... } from "../lib/utils.ts"`
- Never use absolute paths or path aliases
- The `core/` files (`utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`) are imported by almost everything — keep them lightweight and dependency-free

## Adding New Files

1. Place the file directly in `src/lib/` (no subdirectories)
2. Import from `core/` files as needed
3. Export only what's needed by CLI tools or tests
4. Add unit tests in `test/<name>.unit.test.ts`
