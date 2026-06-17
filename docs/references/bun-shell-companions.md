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

| Mode | Behavior |
| ---- | -------- |
| `off` | Rule is not scanned |
| `report` | Violations are baselined; CI fails only on **new** violations |
| `enforce` | Zero tolerance |

Workflow:

```bash
bun run bun-native:rules                  # catalog + counts
bun run bun-native:batch process-env      # focused fix list
bun run bun-native:baseline -- --rule process-env  # shrink baseline after a batch
# when count hits 0, set rules.process-env = "enforce" in bun-native-lint.toml
bun run bun-native:check                  # gate (report mode + baseline ratchet)
```

Baseline file: `.bun-native-baseline.json` (committed). Promote rules to `enforce` only after the baseline entry count for that rule reaches zero.
