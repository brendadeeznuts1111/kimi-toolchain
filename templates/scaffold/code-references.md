# Code References for Agents

Use this file to map good local examples before future agents add code. Replace placeholders with real project paths as the codebase grows.

## Read Order

1. Read `CONTEXT.md` for the domain model and current architecture.
2. Read this file for local implementation examples.
3. If this file is incomplete, use `~/.kimi-code/CODE_REFERENCES.md` as fallback guidance.
4. Pick the closest existing local implementation before writing a new pattern.

## Local Exemplars

| Need                   | Local reference    | Notes                                                        |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| App entrypoint         | `src/index.ts`     | Effect-typed server lifecycle with `Effect.gen` + `ensuring` |
| CLI or script boundary | `scripts/check.ts` | Replace with the real script pattern                         |
| Config parsing         | `src/config.ts`    | Prefer narrow interfaces and parser checks                   |
| Logging/status output  | `src/logger.ts`    | Prefer existing logger/helper before raw console output      |
| External API client    | `src/api.ts`       | Keep retries/timeouts explicit                               |
| Tests                  | `test/`            | Match local test style and fixtures                          |

## Effect and Schema Guidance

- Use Effect only when the project already uses it or the workflow needs typed failures, cleanup, subprocess orchestration, or parallel aggregation.
- Keep pure helpers plain and easy to unit test.
- Prefer TypeScript interfaces, type guards, parser checks, and focused tests before adding schema packages.
- New dependencies require intentional approval, `dx package`, `kimi-guardian check`, and tests that show the dependency is needed.

### Effect patterns (see `src/index.ts`)

| Pattern                 | Where used                         | Docs                                                       |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `Data.TaggedError`      | `ServerStartError`, `RouteError`   | https://effect.website/docs/error-management/tagged-errors |
| `Effect.gen`            | Server lifecycle control flow      | https://effect.website/docs/effect/gen                     |
| `Effect.ensuring`       | Graceful server shutdown           | https://effect.website/docs/effect/ensuring                |
| `Effect.runPromiseExit` | Structured exit code handling      | https://effect.website/docs/runtime                        |
| `Effect.fail`           | Typed error propagation (no throw) | https://effect.website/docs/error-management/tagged-errors |

## Checklist

Before adding code:

1. Add or update the relevant row above.
2. Match the closest local example.
3. Keep parsing and mutation at boundaries.
4. Add focused tests for new behavior.
