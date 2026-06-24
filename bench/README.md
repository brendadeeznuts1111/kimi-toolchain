# Benchmarks

Microbenchmarks for performance-critical paths, organized by category like Bun's
[`oven-sh/bun/tree/main/bench`](https://github.com/oven-sh/bun/tree/main/bench).

## Running

```bash
bun run bench
```

The runner discovers every `bench/<category>/*.bench.ts` module, executes the
benchmarks, and prints a unified report.

## Adding a benchmark

1. Create a file under `bench/<category>/` (e.g. `bench/crypto/hmac.bench.ts`).
2. Export a function that returns `{ label, sample }[]` or `Promise<{ label, sample }[]>`.
3. Import helpers from `../lib/timing.ts`:
   - `benchSync(fn, iterations)` for synchronous work
   - `benchAsync(fn, iterations)` for asynchronous work
   - `formatBenchLine(label, sample)` for rendering (used by the runner)
4. Wire the new module into `bench/runner.ts`.

## Category layout

| Directory           | Benchmarked area                |
| ------------------- | ------------------------------- |
| `bench/crypto/`     | hashing and crypto operations   |
| `bench/parse/`      | JSON, TOML, NDJSON parsing      |
| `bench/governance/` | R-Score / governance scoring    |
| `bench/memory/`     | memory budget / RSS sampling    |
| `bench/process/`    | process enumeration and caching |

## Helpers

- `bench/lib/timing.ts` — Bun.nanoseconds-based microbenchmark helpers aligned
  with [Bun benchmarking docs](https://bun.com/docs/project/benchmarking).
