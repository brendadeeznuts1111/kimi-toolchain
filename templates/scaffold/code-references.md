# Code References for Agents

Use this file to map good local examples before future agents add code. Replace placeholders with real project paths as the codebase grows.

## Read Order

1. Read `CONTEXT.md` for the domain model and current architecture.
2. Read this file for local implementation examples.
3. If this file is incomplete, use `~/.kimi-code/CODE_REFERENCES.md` as fallback guidance.
4. Pick the closest existing local implementation before writing a new pattern.

## Local Exemplars

| Need                    | Local reference          | Notes                                                     |
| ----------------------- | ------------------------ | --------------------------------------------------------- |
| App entrypoint          | `src/index.ts`           | Replace with the real entrypoint                          |
| Quality gate scripts    | `scripts/check.ts`       | Gate runner pattern for format/lint/test                  |
| Finish-work (toolchain) | `scripts/finish-work.ts` | Toolchain profile only — gates + optional git             |
| Config parsing          | `dx.config.toml`         | Prefer narrow interfaces and parser checks                |
| Logging/status output   | `scripts/check.ts`       | Scripts use gate-runner; CLIs: see global CODE_REFERENCES |
| External API client     | `src/api.ts`             | Keep retries/timeouts explicit                            |
| Tests                   | `test/`                  | Match local test style and fixtures                       |

## Effect and Schema Guidance

- Use Effect only when the project already uses it or the workflow needs typed failures, cleanup, subprocess orchestration, or parallel aggregation.
- Keep pure helpers plain and easy to unit test.
- Prefer TypeScript interfaces, type guards, parser checks, and focused tests before adding schema packages.
- New dependencies require intentional approval, `dx package`, `kimi-guardian check`, and tests that show the dependency is needed.

## Checklist

Before adding code:

1. Add or update the relevant row above.
2. Match the closest local example.
3. Keep parsing and mutation at boundaries.
4. Add focused tests for new behavior.
