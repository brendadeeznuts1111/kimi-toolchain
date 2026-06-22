---
title: "Bun Shell Companions"
tags: [references, reference, bun]
category: core
status: draft
priority: medium
---
# Bun Shell Companion Reference

Companion patterns for shell execution and related Bun-native APIs used across `kimi-toolchain`.

## Inspection and Formatting

All inspection, table formatting, ANSI helpers, and inspection streaming live in `src/lib/inspect.ts`.

| Need                                          | Use                                 | Avoid                                     |
| --------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| Pretty-printing objects for humans            | `inspectHuman()`                    | Raw `Bun.inspect` scattered through code  |
| Pretty-printing objects for agents / `--json` | `inspectAgent()`                    | Raw `JSON.stringify` for stdout emission  |
| Table formatting                              | `formatTable()`                     | Ad-hoc string concatenation               |
| Deep equality                                 | `deepEqual()` / `deepEqualStrict()` | `JSON.stringify(a) === JSON.stringify(b)` |
| Strip ANSI                                    | `stripANSI()`                       | Hand-rolled regex                         |
| Wrap text with ANSI awareness                 | `wrapAnsi()`                        | Manual slicing                            |
| Custom inspection symbol                      | `customInspect`                     | Hard-coding `Bun.inspect.custom`          |
| Stream → text                                 | `inspectStream()`                   | `new Response(stream).text()`             |

## JSON / Machine Output

- Use `inspectAgent()` for deterministic, structured output on stdout in `--json` mode.
- Use `JSON.stringify` only for persistence formats (JSONL files, hash inputs) where exact JSON is required.
- When a line needs both a trailing newline and deterministic serialization, compose as `inspectAgent(obj) + "\n"`.

## Effect discipline repairs

After `kimi-heal effect audit` reports bare Promise or domain import violations, run **`kimi-heal --fix`** (or `effect audit --fix`) to apply AST-guided repairs in `src/lib/effect-heal-fix.ts`. Re-run `kimi-doctor --effect-gates` to verify.

## Logging Configuration Presets

`configureInspect()` is a lightweight, zero-dependency preset system that installs
a configured `Bun.inspect` wrapper from runtime environment detection. Use it once
at startup for CLIs, dashboards, scrapers, and long-running services where explicit
`Bun.inspect(value)` output should be readable locally and compact in CI or production.
The active preset is also mirrored on `Bun.inspect.options` for introspection.

| Preset           | `depth`    | `colors`        | `compact` | `sorted` | `maxArrayLength` | `showHidden` | Primary trigger / use case       |
| ---------------- | ---------- | --------------- | --------- | -------- | ---------------- | ------------ | -------------------------------- |
| `auto` (TTY dev) | `5`        | `true`          | `false`   | `true`   | `Infinity`       | `false`      | Local terminal default           |
| `auto` (non-TTY) | `4`        | `false`         | `true`    | `true`   | `100`            | `false`      | CI, pipes, redirected output     |
| `auto` (prod)    | `2`        | `false`         | `true`    | `false`  | `30`             | `false`      | `NODE_ENV=production`            |
| `debug`          | `Infinity` | `true` when TTY | `false`   | `true`   | `Infinity`       | `true`       | `DEBUG_INSPECT=1\|true\|yes\|on` |
| `development`    | `5`        | `true` when TTY | `false`   | `true`   | `Infinity`       | `false`      | Explicit development preset      |
| `production`     | `2`        | `false`         | `true`    | `false`  | `30`             | `false`      | Explicit production preset       |
| `compact`        | `3`        | `false`         | `true`    | `false`  | `50`             | `false`      | Explicit compact/minimal preset  |

Key behavior:

- `configureInspect()` defaults to `auto`, using `process.stdout.isTTY` and
  `Bun.env.NODE_ENV`.
- `DEBUG_INSPECT=1`, `true`, `yes`, or `on` forces the `debug` preset regardless
  of the preset argument.
- Caller overrides are applied last, so `configureInspect("production", { depth: 3 })`
  keeps production defaults except for `depth`.
- Production deliberately limits depth and disables colors and hidden properties.

```ts
import { configureInspect } from "../src/lib/inspect.ts";

configureInspect();
// configureInspect("debug");
// configureInspect("production", { depth: 3 });

Bun.inspect(largeObject);
```

`console.log(value)` uses Bun's console formatter and does not currently inherit
the exported `Bun.inspect` wrapper in every Bun version. Use `Bun.inspect(value)`
or the shared `inspectHuman()` helper when the configured preset must apply.

For a one-off troubleshooting run:

```bash
DEBUG_INSPECT=1 bun run src/index.ts
```

Dashboards can expose the current return value from `configureInspect("auto")`.
The example dashboard serves this at `/api/inspect-config`.

## Deep Equality

- `deepEqual(a, b)` maps to `Bun.deepEquals(a, b)`.
- `deepEqualStrict(a, b)` maps to `Bun.deepEquals(a, b, true)` and is used for constant-drift verification and config alignment (`bun run sync:verify`).

## Timing

- Use `Bun.nanoseconds()` for high-precision timing in benchmarks and confidence scoring.
- Do not use `Date.now()` for micro-benchmarks.

## Environment

- Read environment variables through `Bun.env` (typed).
- Do not use `process.env` in new code. The Bun-native lint gate rejects it.

## Module Resolution

- Use `Bun.resolveSync(specifier, from)` for synchronous resolution.
- Use `import.meta.resolve(specifier)` when async resolution is acceptable.

## Streams

- Prefer `Bun.readableStreamToText(stream)` for converting a `ReadableStream` to text.
- Prefer `for await...of` over `.on("data", ...)` for stream consumption.

## Exemptions

If a specific line must use a non-preferred API, add `// @bun-native-exempt` and a brief comment explaining why.

## Phased enforcement

The Bun-native gate (`scripts/lint-bun-native.ts`) rolls out slowly via `bun-native-lint.toml`:

| Mode      | Behavior                                                      |
| --------- | ------------------------------------------------------------- |
| `off`     | Rule is not scanned                                           |
| `report`  | Violations are baselined; CI fails only on **new** violations |
| `enforce` | Zero tolerance                                                |

Workflow:

```bash
bun run bun-native:rules                  # catalog + counts
bun run bun-native:batch process-env      # focused fix list
bun run bun-native:baseline -- --rule process-env  # shrink baseline after a batch
# when count hits 0, set rules.process-env = "enforce" in bun-native-lint.toml
bun run bun-native:check                  # gate (report mode + baseline ratchet)
```

Baseline file: `.bun-native-baseline.json` (committed). Promote rules to `enforce` only after the baseline entry count for that rule reaches zero.
## Related

- [INDEX.md](../INDEX.md) — Documentation index
