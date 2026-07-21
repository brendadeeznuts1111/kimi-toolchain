# Test execution model

> Convergence foundation for how kimi-toolchain selects, distributes, and runs tests.
> **Code SSOT:** `BUN_TEST_EXECUTION_STRATEGY`, `KIMI_TEST_RUN_ENTRIES`, and `BUN_TEST_CHANGED_STRATEGY` in `src/lib/test-runtime.ts`.
> **Author guide:** [test/testing.md](../../test/testing.md).

Bun's test runner has two independent axes:

1. **Selection** — which test files to run (explicit list, git import graph, or full discovery).
2. **Distribution** — how selected files are scheduled (`--parallel` workers, `--shard` CI splits).

`describe()` blocks affect **presentation and logical grouping only**. Sharding and worker parallelism operate on **files**, not nested describes.

---

## Four primary entry points

| Script          | Selection                                       | Distribution                                    | Typical use                                                            |
| --------------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `test:fast`     | Explicit `UNIT_TEST_FILES` from `test-gates.ts` | `--parallel=4`, chunked batches                 | Default iteration; `check:fast`; pre-commit when hooks run unit gate   |
| `test:group`    | Domain group from `TEST_GROUPS`                 | `--isolate`, optional `--dots` / `--quiet`      | Focused domain runs without overlap                                    |
| `test:path`     | Arbitrary glob(s)                               | `--isolate`, optional reporter flags            | One-off path selection                                                 |
| `test:changed`  | Git import graph (`--changed=HEAD`)             | `--parallel=4`                                  | Pre-commit speed — only tests transitively depending on changed source |
| `test:parallel` | Bun recursive discovery (all `*.test.ts` tiers) | `--parallel=4`, `--bail`, `--retry=2`, `--dots` | Full-suite local throughput                                            |
| `test:shard`    | Same as `test:parallel`                         | above + `--shard=${BUN_TEST_SHARD:-1/1}`        | CI matrix; local shard simulation                                      |

### Related scripts

| Script               | Role                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `test`               | Tier chain via `scripts/run-tests.ts`: unit → integration → smoke (explicit file lists per tier) |
| `test:ci`            | CI shard using `${CI_NODE_INDEX}/${CI_NODE_TOTAL}`                                               |
| `test:changed:push`  | `test-changed.ts --push` — compares against `@{upstream}` for pre-push                           |
| `test:changed:shard` | `--changed=main` + parallel + shard — PR jobs with branch filter                                 |
| `test:changed:group` | Group + `--changed=HEAD` — only changed tests inside a domain group                              |
| `test:changed:path`  | Path glob + `--changed=HEAD` — only changed tests under a path                                   |
| `check:fast:changed` | Full fast gate scoped to changed files, with pass cache                                          |

### Implementation map

<!-- lint-testing-docs:skip -->

```
package.json scripts
  test:fast          → scripts/test-fast.ts        → runTestTier("unit")
  test:group         → scripts/test-fast.ts        → resolveTestGroupFiles(<name>) → runBunTest
  test:path          → scripts/test-fast.ts        → resolveTestGroupFiles(<glob>, existingOnly=false) → runBunTest
  test:changed       → scripts/test-changed.ts     → bunTestArgsForChanged(HEAD | upstream)
  test:changed:group → scripts/test-fast.ts        → resolveTestGroupFiles(<name>) + --changed=HEAD
  test:changed:path  → scripts/test-fast.ts        → resolveTestGroupFiles(<glob>) + --changed=HEAD
  test:parallel      → bare bun test               → full discovery
  test:shard         → bare bun test + --shard     → full discovery, one shard
  test               → scripts/run-tests.ts        → runAllTestTiers
```

---

## Selection axis

| Mode                     | Mechanism                               | Scope                                                                         |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| **Explicit file list**   | `test-gates.ts` → tier runners          | Unit / integration / smoke lists only                                         |
| **Domain group**         | `TEST_GROUPS` → `resolveTestGroupFiles` | Mutually exclusive groups (`bun`, `core`, `doctor`, `herdr`, …)               |
| **Arbitrary path**       | `--path <glob>`                         | Any test file matching the provided glob(s)                                   |
| **Git import graph**     | Bun `--changed`                         | Any discovered test file whose static import graph reaches a git-changed file |
| **Group/path + changed** | `--group <name> --changed=HEAD`         | Intersection of a group/path with the changed-import graph                    |
| **Scoped pass cache**    | `.kimi/.last-good-scoped-gates`         | Skip `test:fast` when staged files are a subset of a previous pass            |
| **Full discovery**       | Bun recursive `*.test.ts` patterns      | All test files in the repo (unit, integration, smoke, db, etc.)               |

`TEST_GROUPS` is intentionally mutually exclusive: a file belongs to exactly one group, so running `bun run test:group -- bun core` together never duplicates files. `scripts/lint-test-names.ts` and `test/test-gates.unit.test.ts` enforce full coverage and no overlaps.

Use `test:changed`, `test:changed:group`, `test:changed:path`, or `check:fast:changed` to avoid re-running tests whose imports are unchanged. The scoped pass cache adds an additional skip layer inside `check:fast:changed`.

### `test:changed` — the selective runner

`scripts/test-changed.ts` builds:

```bash
bun test --changed=HEAD --isolate --parallel=4 --timeout 30000
```

Pre-push (`test:changed:push`) resolves `@{upstream}` (fallback: `origin/main`, `main`, `HEAD~1`).

Bun walks the **static import graph** from changed files to test files. Overhead is low — imports are scanned without linking or entering `node_modules`.

#### Known limitations (acceptable for speed)

`test:changed` may miss indirect effects when:

- A shared utility changed but no test file **statically imports** it.
- Wiring is dynamic (`import()`, string `require`, config-only paths).
- Global side effects change behavior without an import edge.

**Safety net:** `test:parallel` and `test:shard` run full discovery. Use them in CI or before merge when breadth matters more than latency.

---

## Distribution axis

Bun schedules at **file** granularity:

| Flag           | Unit | Behavior                                                                        |
| -------------- | ---- | ------------------------------------------------------------------------------- |
| `--parallel=N` | File | Up to N workers; files partitioned with work-stealing; output buffered per file |
| `--shard=M/N`  | File | Sorted paths, round-robin across shards (balanced within ±1 file)               |
| `--isolate`    | File | Clean module graph per file (workers auto-isolate under `--parallel`)           |

Constants: `BUN_TEST_FLAG_INTERACTIONS.shardDeterminism`, `parallelScheduling`, `parallelConsole`.

### `describe` vs separate files

| Goal                      | `describe` (nested)                         | Separate `.test.ts` files                                                   |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Output readability        | Presentation only (reporter hierarchy)      | Actual distribution (per-file buffered output under `--parallel`)           |
| Finer shard balancing     | Presentation only (one shard unit per file) | Actual distribution (more shard units)                                      |
| Worker parallelism        | Same file → same worker                     | Workers run files concurrently                                              |
| Logical contract grouping | **Recommended**                             | Use file stem + top-level `describe`; split files when distribution matters |

**Rule:** `describe` organizes within a module; separate files distribute across workers and CI shards. The repo uses both (e.g. many nested describes inside `test-runtime.unit.test.ts`, many files in `UNIT_TEST_FILES`).

### Within-file concurrency (separate concern)

`--concurrent` / `test.concurrent()` parallelizes tests **inside** one file on the same worker. It does not replace file-level `--parallel` or `--shard`.

---

## Safety-net model

```
test:changed  ──► fast feedback (import graph, may miss indirect edges)
       │
       ▼
test:parallel ──► full discovery, all workers locally
       │
       ▼
test:shard    ──► full discovery, one CI slice
```

| Layer                 | Command                                                     | When                    |
| --------------------- | ----------------------------------------------------------- | ----------------------- |
| Edit loop             | `bun run test:changed` or `bun run test:fast`               | Every save / pre-commit |
| Pre-push              | `test:changed:push` or `check:fast`                         | Hook gates              |
| CI / merge confidence | `test:parallel`, `test:shard`, `test:ci`, or `bun run test` | Breadth over speed      |

### Runner guardrails (2026-07)

Two guardrails keep gates from hanging the machine (see `docs/flake-register.md`):

- **Project test gate** — `scripts/check.ts` and `scripts/test-fast.ts` hold a
  lock at `.kimi-test-locks/` (owner pid in `owner.json`). A second concurrent
  gate fails fast with the owner's pid/command instead of two gates corrupting
  shared state. Stale locks (dead owner) are cleaned automatically, and
  `kimi-orphan-kill` sweeps them too. Escape hatch: `KIMI_ALLOW_CONCURRENT_TESTS=1`.
- **Wall-clock watchdogs** — `runGate` kills any gate step that exceeds
  `KIMI_CHECK_FAST_TIMEOUT_MS` (default 10 min); `runTestTier` kills a test
  batch that exceeds `KIMI_TEST_BATCH_WALL_CLOCK_MS` (default 5 min) and
  retries it once. A spinning canary runner becomes a bounded, retried run
  instead of an infinite hang.

---

## Environment variables

| Variable                          | Used by                            | Default            |
| --------------------------------- | ---------------------------------- | ------------------ |
| `BUN_TEST_SHARD`                  | `test:shard`, `test:changed:shard` | `1/1` (no split)   |
| `CI_NODE_INDEX` / `CI_NODE_TOTAL` | `test:ci`                          | `1` / `1`          |
| `KIMI_TEST_PARALLEL`              | `buildBunTestArgs` fast path       | `4`                |
| `KIMI_TEST_BATCH_WALL_CLOCK_MS`   | `runTestTier` batch watchdog       | `300000` (5 min)   |
| `KIMI_CHECK_FAST_TIMEOUT_MS`      | `runGate` step watchdog            | `600000` (10 min)  |
| `KIMI_ALLOW_CONCURRENT_TESTS`     | test gate lock                     | unset (serialized) |

---

## Name filter (`--grep`)

Bun >= 1.3.6 adds `--grep` as an alias for `--test-name-pattern` (same role as Jest `-t`):

```bash
bun test --grep "archive round-trip"
bun test --test-name-pattern "archive round-trip"
bun test -t "archive round-trip"
```

Use with an explicit file path for fast TDD loops. Tier scripts (`test:fast`, `test:changed`) do not pass `--grep` — add it manually when debugging a single `describe` or `test` name inside a known file.

---

## Agent decision table

| If you need…                                    | Use                                      |
| ----------------------------------------------- | ---------------------------------------- |
| Fastest unit gate with explicit file list       | `bun run test:fast`                      |
| Focused domain run (no overlap between groups)  | `bun run test:group -- <name>`           |
| Arbitrary test path glob                        | `bun run test:path -- '<glob>'`          |
| Only tests affected by local edits              | `bun run test:changed`                   |
| Only changed tests in a group                   | `bun run test:changed:group -- <name>`   |
| Only changed tests under a path                 | `bun run test:changed:path -- '<glob>'`  |
| Tests affected since upstream branch (pre-push) | `bun run test:changed:push`              |
| Full fast gate scoped to changed files + cache  | `bun run check:fast:changed`             |
| Full suite, one machine, fast                   | `bun run test:parallel`                  |
| Simulate or run one CI shard                    | `BUN_TEST_SHARD=2/4 bun run test:shard`  |
| Full tier chain (unit → integration → smoke)    | `bun run test`                           |
| Single file debug                               | `bun test ./test/foo.unit.test.ts`       |
| Filter by test/describe name (Bun >= 1.3.6)     | `bun test --grep "should handle"`        |
| Contract constants and flag compositions        | `src/lib/test-runtime.ts` (`BUN_TEST_*`) |

---

## Portal display

Import-graph mechanics flow through the **benchmark envelope** (portal SSOT), not a separate artifact:

| Surface        | Path                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Live probe     | `GET /api/effect-benchmark` → `metadata.testExecution.changedImportGraph`                                     |
| Dashboard card | `GET /api/bun-test` → `changedImportGraph` (same constant)                                                    |
| Saved artifact | `jq '.payload.payload.metadata.testExecution.changedImportGraph' .kimi/artifacts/artifact-portal/<file>.json` |
| Build report   | `bun run build:portal --local-only` prints `import-graph:` line + `changedImportGraphTitle` in `--json`       |

Dashboard deep link: `http://127.0.0.1:5678/?example=portal&canvas=benchmark#card-bun-test`

Contract: `contracts/artifact-portal.json` (`companionRoutes.bunTest`, `influences` includes `card-bun-test`).

## See also

- [test/testing.md](../../test/testing.md) — naming, isolation, snapshots, watch modes
- [configuration-layers.md](./configuration-layers.md) — define vs discovery vs scaffold layers
- Bun docs: [test runner](https://bun.com/docs/test), [runtime behavior](https://bun.com/docs/test/runtime-behavior)
