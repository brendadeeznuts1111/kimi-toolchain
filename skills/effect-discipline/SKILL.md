---
name: effect-discipline
description: |
  L1+L2 guidance for Effect-TS in kimi-toolchain. When to use Effect, CLI runCliExit
  pattern, subprocess boundaries, and pre-commit effect-gates. Load when touching
  src/lib/effect/, adding a CLI with runCliExit, or fixing effect-gates failures.
whenToUse: |
  Editing src/lib/effect/, new Effect CLI mains, effect-gates or kimi-heal effect
  audit failures, or subprocess code that should use invokeToolEffect at the boundary.
---

# Effect discipline (L1 + L2)

Use this skill when you are:

- Editing or creating code under `src/lib/effect/`
- Adding a CLI that exits via `runCliExit()`
- Fixing an `effect-gates` pre-push failure or `kimi-heal effect audit` output
- Wrapping subprocess / tool-runner work at an Effect boundary

Depth (threshold tables, JSON report shape, ADR rationale): [DEEP-QUALITY.md](~/.kimi-code/DEEP-QUALITY.md). Exemplars: [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Effect Patterns.

## When to use Effect

**Do** when a path needs typed failures, telemetry-safe cleanup, or parallel orchestration:

- CLI mains with structured exit codes and error taxonomy
- Subprocess boundaries (`invokeToolEffect`, `tool-runner-effect.ts`)
- Parallel doctor / gate aggregation (`Effect.all` — see `doctor-pipeline.ts`)

**Avoid** for:

- Pure synchronous helpers and data transforms (plain TypeScript)
- One-off scripts with no boundary or tracing needs
- Cases where `Effect.gen` / `pipe` hurts readability more than it helps

## CLI recipe

Keep the imperative shell thin: parse argv → build an Effect program → single exit:

```ts
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const program = Effect.gen(function* () {
  // business logic — fail with CliError or tagged errors, not throw
});

await runCliExit(program, { toolName: "my-tool", argv: Bun.argv });
```

Reference mains: `src/bin/kimi-toolchain.ts`, `src/lib/effect/cli-runtime.ts`, `src/lib/effect/errors.ts`.

## Subprocess / tool boundary

- Use `invokeToolEffect()` / `runToolEffect()` from `src/lib/effect/tool-runner-effect.ts` at the boundary.
- Preserve taxonomy fields when converting subprocess results (`taxonomyId`, `suggestion`, `autoFix`).
- Do not leak raw `Promise` or untagged strings across the Effect layer.

## Before commit

```bash
kimi-doctor --effect-gates
kimi-heal effect audit --check-tags
```

Pre-push enforces effect-gates. These are not suggestions.

Escape hatch: `KIMI_SKIP_EFFECT_GATES=1` only in emergencies — document in the commit message.

## Gate IDs (`EFFECT_GATES`)

Identifiers enforced by `src/lib/effect-gates.ts` (keep in sync with `error-taxonomy.yml`):

- `direct-promise`
- `layer-circularity`
- `missing-service-tag`
- `domain-purity`
- `run-promise-boundary`
- `event-stream`

Full scanner logic and thresholds: [DEEP-QUALITY.md](~/.kimi-code/DEEP-QUALITY.md).

## Do not

- Call `process.exit()` inside business logic — use `runCliExit` or `Effect.fail` at the boundary
- Wrap pure helpers in Effect because “everything should be Effect”
- Catch all failures and re-label as a single `ToolNotFound`
- Duplicate threshold tables from DEEP-QUALITY into this skill or inline comments

## Related skills

- **effect-hardening** — L3 modules (service scaffold, streams, layers, boundary validation)
- **kimi-toolchain** — project health, `bun run check`, guardian, sync
- **herdr** / **orchestrator** — pane layout vs cross-pane coordination (separate from Effect discipline)

## Bundled references

Pointer index only: `references/README.md` in this skill directory (synced with `bun run sync`).
L3 templates and gate rule JSON: `skills/effect-hardening/` (synced with `bun run sync`).
