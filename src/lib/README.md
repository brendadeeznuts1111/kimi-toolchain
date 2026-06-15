# src/lib/ — Domain Guide

This directory contains shared modules used by CLI tools and tests.
The structure is flat by default to avoid deep import paths and circular dependency issues.
`effect/` is the intentional exception for Effect adapters and typed CLI/runtime errors.

For agent-facing examples of the preferred patterns, see `../../CODE_REFERENCES.md`.

## Domains

| Domain         | Files                                                                                                             | Purpose                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Core**       | `utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`, `health-check.ts`, `logger.ts`                            | Shared utilities, health checks, structured logging, tool execution |
| **Effect**     | `effect/` (`errors`, `config`, `tool-runner-effect`, `cli-runtime`)                                               | Effect-TS subprocess orchestration and unified CLI exit handling    |
| **Governance** | `r-score.ts`, `governance-check.ts`, `governance.ts`, `readme-sync.ts`                                            | R-Score calculation, license/CONTRIBUTING checker, README drift     |
| **Scaffold**   | `scaffold-templates.ts`, `scaffold-agents.ts`, `scaffold-aligned.ts`, `scaffold-doctor.ts`, `scaffold-quality.ts` | Template generation, AGENTS.md builder, alignment checks            |
| **Cloudflare** | `cloudflare-access.ts`, `cloudflare-access-policy.ts`                                                             | Cloudflare Access API, policy diff/plan/apply                       |
| **Governor**   | `governor-*.ts` (6 files)                                                                                         | Resource limits, parallelism, disk quota, diagnostic cache          |
| **Memory**     | `memory-budget.ts`, `memory-sessions.ts`, `sessions-schema.ts`                                                    | System memory checks, session store, DB schema                      |
| **Git**        | `git-helpers.ts`, `conventional-commits.ts`, `changelog.ts`                                                       | Git operations, conventional commit parsing, changelog generation   |
| **Config**     | `mcp-config.ts`, `kimi-config-audit.ts`, `test-gates.ts`, `artifacts.ts`                                          | MCP configuration, Kimi config audit, test gate and artifact paths  |
| **Health**     | `workspace-health.ts`, `workspace-commands.ts`, `legacy-cleanup.ts`, `ecosystem-health.ts`                        | Workspace health, commands, legacy cleanup, ecosystem checks        |
| **Process**    | `process-utils.ts`, `snapshot-core.ts`                                                                            | Orphan process detection, snapshot management                       |
| **Doctor**     | `doctor-runs.ts`, `doctor-pipeline.ts`                                                                            | Doctor run persistence + parallel sub-doctor aggregation            |
| **Sync**       | `desktop-sync.ts`, `sync-hashes.ts`, `sync-manifest.ts`                                                           | Desktop sync, hash verification, manifest generation                |
| **Registry**   | `tool-registry.ts`                                                                                                | Tool registry                                                       |
| **Taxonomy**   | `error-taxonomy.ts`                                                                                               | Error taxonomy                                                      |

## Import Rules

- Import from `src/lib/` using relative paths: `import { ... } from "../lib/utils.ts"`
- Never use absolute paths or path aliases
- The `core/` files (`utils.ts`, `version.ts`, `paths.ts`, `tool-runner.ts`) are imported by almost everything — keep them lightweight and dependency-free

## Adding New Files

1. Place the file directly in `src/lib/` unless there is a documented exception like `src/lib/effect/`
2. Import from `core/` files as needed
3. Export only what's needed by CLI tools or tests
4. Add unit tests in `test/<name>.unit.test.ts`
