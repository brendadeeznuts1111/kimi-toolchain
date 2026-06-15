# Code References for Agents

This file points future agents at local examples that define the code style for this repo. Read the matching section before adding new code; prefer extending these patterns over inventing a parallel one.

## Core Defaults

| Need                          | Reference                              | Follow                                                                                      |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cross-tool subprocess calls   | `src/lib/tool-runner.ts`               | Use `invokeTool()` / `runTool()`, bounded output, timeout, env overlay, taxonomy enrichment |
| Effect wrapper for tool calls | `src/lib/effect/tool-runner-effect.ts` | Convert runner results to typed Effect failures at the boundary                             |
| CLI exit handling             | `src/lib/effect/cli-runtime.ts`        | Wrap CLI mains in `runCliExit()` and map failures to exit codes centrally                   |
| Tagged errors                 | `src/lib/effect/errors.ts`             | Use `Data.TaggedError` for typed, inspectable failures                                      |
| Structured logging            | `src/lib/logger.ts`                    | Use `createLogger(Bun.argv, toolName)`, `logger.check()`, and `logger.printHealthReport()`  |
| Health report shape           | `src/lib/health-check.ts`              | Return `{ name, status, message, fixable }` checks and aggregate once                       |
| Path ownership                | `src/lib/paths.ts`                     | Use helpers for `~/.kimi-code`, `~/.agents`, and runtime paths                              |
| Safe parsing                  | `src/lib/utils.ts`                     | Use `safeParse()` / `safeToml()` with validators at config boundaries                       |

## Effect Patterns

Use Effect when a CLI path needs typed failures, telemetry-safe cleanup, or parallel orchestration.

Good local examples:

- `src/lib/effect/cli-runtime.ts` for CLI main lifecycle and telemetry `ensuring`.
- `src/lib/effect/tool-runner-effect.ts` for adapting Promise-based subprocess work to typed failures.
- `src/lib/doctor-pipeline.ts` for `Effect.all` parallel doctor aggregation.
- `src/bin/kimi-toolchain.ts` for a thin CLI main that delegates to `runCliExit()`.

Do:

- Keep the imperative boundary small: parse argv, build an Effect program, then call `runCliExit()`.
- Use tagged errors from `src/lib/effect/errors.ts` rather than throwing generic strings.
- Preserve taxonomy fields (`taxonomyId`, `suggestion`, `autoFix`) when converting subprocess results.

Avoid:

- Mixing `process.exit()` throughout business logic.
- Catching all Effect failures and re-labeling them as `ToolNotFound`.
- Adding `Effect` to simple pure helpers that are easier to test as plain functions.

## Config and Schema Patterns

This repo intentionally avoids large schema dependencies. Config boundaries should be explicit, small, and test-covered.

Good local examples:

- `src/lib/cloudflare-access-policy.ts` for a narrow policy config interface plus parser.
- `src/lib/kimi-config-audit.ts` for targeted TOML extraction and validation.
- `src/lib/mcp-config.ts` for config merge/idempotency behavior.
- `test/cloudflare-access-policy.unit.test.ts` and `test/mcp-config.unit.test.ts` for parser and merge expectations.

Do:

- Define TypeScript interfaces near the config loader.
- Validate untrusted JSON/TOML/YAML with small type guards or parser checks.
- Make merge functions idempotent and add tests for repeated runs.

Avoid:

- Casting parsed config to broad `any` and using it across module boundaries.
- Adding a schema package for one config file. New runtime dependencies must earn their cost and pass guardian.

## Package Policy

`package.json` is intentionally small. Runtime dependencies are currently:

- `effect` for typed Effect pipelines.
- `js-yaml` for Cloudflare Access policy config parsing.

Before adding a dependency:

1. Prefer Bun built-ins or an existing local helper.
2. Run `dx package` if the global DX layer is active for the target project.
3. Run `kimi-guardian check` after lockfile changes.
4. If guardian reports an intentional lockfile change, baseline it with explicit approval only.
5. Add tests that show why the dependency is needed.

Do not import packages that are not declared in `package.json`. In this repo that means no `@effect/platform`, Zod, or other schema/effect-adjacent package unless the dependency is intentionally added, reviewed, and gated.

## Testing References

| Need                     | Reference                                                |
| ------------------------ | -------------------------------------------------------- |
| Tool runner behavior     | `test/tool-runner.unit.test.ts`                          |
| Effect CLI lifecycle     | `test/effect/cli-runtime.unit.test.ts`                   |
| Effect tool failures     | `test/effect/tool-runner-effect.unit.test.ts`            |
| Config merge/idempotency | `test/mcp-config.unit.test.ts`                           |
| Policy parser/diff       | `test/cloudflare-access-policy.unit.test.ts`             |
| Scaffold agent output    | `test/scaffold-agents.unit.test.ts`                      |
| Desktop sync drift       | `test/sync.unit.test.ts`, `test/sync-drift.unit.test.ts` |

## Cloudflare and MCP Boundaries

Use these local references before changing Cloudflare or MCP behavior:

- `src/lib/mcp-config.ts` for provisioned MCP defaults (`unified-shell`, `cloudflare-api`).
- `UNIFIED.md` for optional Cloudflare MCP servers and auth boundaries.
- `src/lib/cloudflare-access.ts` and `src/lib/cloudflare-access-policy.ts` for API-token based Access checks.
- `skills/cloudflare-access/SKILL.md` for plan-before-apply rules.

Cloudflare MCP SSO/OAuth, Wrangler OAuth, and `kimi-cloudflare-access` API tokens are separate auth paths. Do not assume one login satisfies the others.

## New Code Checklist

Before writing a new module or CLI path:

1. Identify the closest reference file above.
2. Reuse its logger, runner, path, and error-handling pattern.
3. Keep parsing and mutation at boundaries; keep core logic pure where possible.
4. Add focused unit tests first for new behavior or safety gates.
5. Run `bun run check:fast` during iteration and `bun run check` before commit.
