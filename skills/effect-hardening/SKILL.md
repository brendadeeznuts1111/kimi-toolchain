---
name: effect-hardening
description: |
  L3 Effect-TS hardening for kimi-toolchain — service scaffolds, structured errors,
  event streams, layer composition, and boundary validation. Builds on the
  orchestrator/event architecture and effect-gates enforcement from Phase 1–3.
whenToUse: |
  Creating a new Effect service, wiring reactive streams (watch-events, handoff buses),
  composing Layer stacks, or hardening external-input boundaries. Load after
  effect-discipline when you need module templates, not just gate fixes.
metadata:
  layer: L3
  companionSkill: effect-discipline
  depthDoc: ~/.kimi-code/DEEP-QUALITY.md
---

# Effect-TS codebase hardening

Enforces Effect discipline across kimi-toolchain: event-driven orchestration, structured errors, and agent feedback loops. **L1+L2** gate fixes and CLI boundaries live in **effect-discipline**; this skill is **L3 depth** (scaffolds, streams, layers).

Depth (threshold tables, scanner internals, ADR): [DEEP-QUALITY.md](~/.kimi-code/DEEP-QUALITY.md). Exemplars: [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) § Effect Patterns.

## Core principles (DEEP-QUALITY Dimension 8)

| Principle                 | Enforcement                                     | Gate ID                | Detection                                       |
| ------------------------- | ----------------------------------------------- | ---------------------- | ----------------------------------------------- |
| No bare promises          | Async at Effect boundary only                   | `direct-promise`       | `src/lib/effect-gates.ts` `scanDirectPromises`  |
| Domain purity             | Business logic in `Effect.gen`; I/O at edges    | `domain-purity`        | No `Bun.env` / `node:fs` under `src/domain/`    |
| Tag-only services         | `Context.Tag` + `Layer`, not bare classes       | `missing-service-tag`  | `kimi-heal effect audit --check-tags`           |
| No circular layers        | Acyclic Layer / import graph                    | `layer-circularity`    | `kimi-doctor --effect-gates`                    |
| Structured errors         | `Data.TaggedError` / `Effect.fail`, not `throw` | (review + taxonomy)    | Code review + `src/lib/effect/errors.ts`        |
| `runPromise` boundary     | `runCliExit` at CLI edge only                   | `run-promise-boundary` | Allowed: `src/bin/`, `src/lib/effect/`, `test/` |
| Effect streams for events | `Stream` for reactive pipelines                 | `event-stream`         | `kimi-heal effect audit --event-streams`        |

## Before commit

```bash
kimi-doctor --effect-gates
kimi-heal effect audit --check-tags --event-streams
bun run lint:skills
```

Pre-push enforces effect-gates. Escape hatch: `KIMI_SKIP_EFFECT_GATES=1` only in emergencies — document in the commit message.

## Module 1 — Effect service scaffold

**When:** New service (health probe, audit logger, orchestrator agent facade).

**Template:** `templates/service.ts` (synced via `bun run sync`).

**Checklist:**

- [ ] `Context.Tag` declaration (`class Foo extends Context.Tag("Foo")<Foo, FooService>() {}`)
- [ ] Methods return `Effect.Effect<Success, Error>` or `Stream.Stream<Success, Error>`
- [ ] Errors use `Data.TaggedError` with discriminant `_tag` (see `src/lib/effect/errors.ts`)
- [ ] Live layer uses `Layer.effect` + `Effect.gen` or `Layer.succeed` for thin wrappers
- [ ] Test layer uses `Layer.succeed` with stubs (`DecisionQueryLive` pattern in `decision-services.ts`)
- [ ] No `async`/`await` on the public service interface

**Repo exemplars:** `src/lib/effect/decision-services.ts`, `src/lib/effect/institutional-memory-services.ts`.

## Module 2 — Structured error pipeline

**When:** Operations that can fail (SSH exec, handoff evaluation, probe conditions).

**Template:** `templates/error-pipeline.ts`.

**Checklist:**

- [ ] Error types extend `Data.TaggedError("Name")<{ ... }>` for pattern matching
- [ ] Transient failures carry a `retryable` or taxonomy hint when retrying
- [ ] `Effect.retry` with bounded `Schedule` — no infinite loops
- [ ] `Effect.tapError` for logging; never silent `catchAll(() => Effect.succeed(...))` without justification
- [ ] `Effect.forEach` with explicit `concurrency` for parallel rule evaluation

**Repo exemplars:** `src/lib/effect/errors.ts`, `src/lib/herdr-orchestrator.ts` (SSH + handoff paths).

## Module 3 — Event stream wiring

**When:** Reactive automation (`watch-events`, dashboard refresh, probe polling).

**Template:** `templates/event-stream.ts`.

**Checklist:**

- [ ] Event payloads are discriminated (`_tag` or branded interface)
- [ ] `Stream` for infinite/reactive sources; `Effect` for one-shot RPC
- [ ] `Effect.scoped` when acquiring subscriptions or file handles
- [ ] `Effect.all` / `Effect.fork` with explicit concurrency for producer + consumer pairs
- [ ] No `while (true)` — use `Stream`, `Effect.forever`, or orchestrator debounce

**Repo exemplars:** `src/lib/herdr-orchestrator-events.ts`, `src/bin/herdr-orchestrator.ts` (`watch-events`).

## Module 4 — Layer composition

**When:** Wiring production, test, or mock environments.

**Template:** `templates/layer-composition.ts`.

**Checklist:**

- [ ] Layer graph is a DAG — no circular `Layer.provide` chains
- [ ] Infrastructure → domain → application ordering
- [ ] Test stack mirrors production shape (`OrchestratorTest` ↔ `OrchestratorLive`)
- [ ] `Effect.provide` / `Layer.provide` at program boundary (`runCliExit`), not inside domain helpers
- [ ] Fatal errors logged with `_tag` + context before `Effect.exit`

**Repo exemplars:** `src/lib/effect/decision-services.ts` (`DecisionLayer`), `src/lib/effect/cli-runtime.ts`.

## Module 5 — Validation at boundaries

**When:** Parsing external input (Herdr RPC JSON, config TOML, audit JSONL).

**Template:** `templates/schema-boundary.ts`.

This repo **does not** use `@effect/schema`. Use small type guards, `safeParse<T>()`, and explicit interfaces.

**Checklist:**

- [ ] Untrusted input decoded via `safeParse` or narrow parser functions
- [ ] Parse failures map to `Data.TaggedError` (e.g. `FinishWorkConfigParseError`)
- [ ] Optional fields explicit; numeric bounds checked in parser
- [ ] No `as SomeType` assertions on external JSON — schema/guard is source of truth

**Repo exemplars:** `src/lib/finish-work-config.ts`, `src/lib/kimi-config-audit.ts`, `src/lib/cloudflare-access-policy.ts`.

## Toolchain integration

| Tool                         | Role                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `kimi-doctor --effect-gates` | Full scanner + regression snapshot (`.kimi/var/effect-gates.ndjson`)                           |
| `kimi-heal effect audit`     | Same scanners; `--check-tags` tightens service-tag gate; `--event-streams` enables stream gate |
| `bun run lint:skills`        | Skill ↔ gate ID parity (`effect-discipline`, `effect-hardening`)                               |
| `bun run finish-work`        | Default gates include `kimi-doctor --effect-gates`                                             |

Gate implementation: `src/lib/effect-gates.ts`. Gate IDs:

- `direct-promise`
- `layer-circularity`
- `missing-service-tag`
- `domain-purity`
- `run-promise-boundary`
- `event-stream`

## Bundled resources

| Path                             | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `templates/service.ts`           | Module 1 scaffold                                |
| `templates/error-pipeline.ts`    | Module 2 recovery + aggregation                  |
| `templates/event-stream.ts`      | Module 3 producer/consumer                       |
| `templates/layer-composition.ts` | Module 4 production vs test stacks               |
| `templates/schema-boundary.ts`   | Module 5 boundary validation (no @effect/schema) |
| `rules/no-bare-promises.json`    | `direct-promise` matcher hints                   |
| `rules/tag-only-services.json`   | `missing-service-tag` matcher hints              |
| `rules/structured-errors.json`   | Tagged error conventions                         |

## Do not

- Add `@effect/schema` or other heavy schema deps — use `safeParse` and narrow guards
- Implement auto-fix via regex rewrite (`kimi-heal effect audit` reports; fix by hand)
- Duplicate threshold tables from DEEP-QUALITY into templates or comments
- Put `Effect.runPromise` in `src/lib/` outside `src/lib/effect/`

## Related skills

- **effect-discipline** — L1+L2: when to use Effect, `runCliExit`, subprocess boundaries
- **orchestrator** — Herdr `watch-events` and handoff (consumer of Module 3 patterns)
- **kimi-toolchain** — `bun run check:fast`, guardian, sync
