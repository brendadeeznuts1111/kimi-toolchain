# Testing Conventions — kimi-toolchain

> Bun-native test discipline for this repo. **SSOT for runtime contracts:** `src/lib/test-runtime.ts` (verified by `test/test-runtime.unit.test.ts`).

## Architecture

```
package.json scripts
  → scripts/test-fast.ts | test-run.ts | test-changed.ts | run-tests.ts
  → src/lib/test-runtime.ts (env, tiers, CLI forwarding, Bun doc contracts)
  → bun test

File lists & timeouts: src/lib/test-gates.ts
Naming & patterns:     scripts/lint-test-names.ts (runs in bun run lint)
Preload:               bunfig.toml [test].preload → test/setup.ts
```

| Layer            | Source                    | Role                                                                               |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| **Contracts**    | `src/lib/test-runtime.ts` | Bun behavior SSOT (`BUN_TEST_*`, `KIMI_*`); tier runners                           |
| **Gate files**   | `src/lib/test-gates.ts`   | `UNIT_TEST_FILES`, `INTEGRATION_TEST_FILES`, `SMOKE_TEST_FILES`, timeout constants |
| **Preload**      | `test/setup.ts`           | `NODE_ENV=test`, `TZ`, `KIMI_TEST_HOME`, define globals mirror                     |
| **Config**       | `bunfig.toml` `[test]`    | Declarative preload, `concurrentTestGlob`, coverage defaults                       |
| **Author guide** | This file                 | Naming, isolation, grouping, anti-patterns                                         |

## Entry points

| Command                | Implementation                                 | When to use                                 |
| ---------------------- | ---------------------------------------------- | ------------------------------------------- |
| `bun run test:fast`    | `scripts/test-fast.ts` → `runTestTier("unit")` | Default iteration; pre-commit; `check:fast` |
| `bun run test`         | `scripts/test-run.ts` → `runAllTestTiers`      | Full suite: unit → integration → smoke      |
| `bun run test:changed` | `scripts/test-changed.ts`                      | Branch-scoped gate                          |
| `bun test <file>`      | Bare Bun discovery                             | Single-file debug                           |
| `bun test`             | Bare Bun discovery                             | Avoid in CI; use tier scripts               |

Tier runners pass explicit file paths from `test-gates.ts`, set `--timeout` per tier, and use `--isolate` (+ `--parallel` for unit). They **do not** pass CLI `--preload`; `bunfig.toml` handles preload.

### Watch mode: `--watch` vs `--watch --changed`

| Script               | Equivalent command                                               | Behavior                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:changed:watch` | `bun test --changed --watch --isolate`                           | **Branch-scoped.** Re-filter on every restart — any local `.ts`/`.tsx` edit triggers a re-run via git import graph. **Stays alive** when no changed files are found. |
| `test:watch`         | `bun test --watch --isolate`                                     | Watches the explicit file set (or discovery glob). No git overhead. Best for **dev-loop** iteration.                                                                 |
| File-scoped watch    | `bun test --watch --isolate ./test/foo.unit.test.ts -t "myTest"` | The tightest loop: one file, one name filter. Use for portal or any single-module iteration instead of `--changed --watch`.                                          |

**Guideline:** `--changed --watch` restarts on **any** `.ts`/`.tsx` edit in the repo, even files not imported by the selected tests. For single-file dev loops, prefer `bun test --watch --isolate ./test/<file>` — no git overhead, no false restarts.

When no changed files are found: `--changed --watch` stays alive (waits for the next edit), while bare `bun test --changed` exits cleanly with code 0. This is by design — the watch variant keeps the process as a long-lived file watcher.

### Timeouts

| Tier                          | Per-test timeout | Constant                      |
| ----------------------------- | ---------------- | ----------------------------- |
| Fast unit gate                | 30 s             | `FAST_TEST_TIMEOUT_MS`        |
| Integration / default         | 30 s             | `DEFAULT_TEST_TIMEOUT_MS`     |
| Smoke                         | 60 s             | `SMOKE_TEST_TIMEOUT_MS`       |
| Bun default (bare `bun test`) | 5 s              | `BUN_TEST_DEFAULT_TIMEOUT_MS` |

CLI `--timeout` on tier runners **overrides** any `bunfig.toml` `[test].timeout`.

## `bun:test` module

- **Prefer explicit imports** from `"bun:test"` (see `BUN_TEST_EXPLICIT_IMPORT` in `test-runtime.ts`).
- Add `mock` when testing boundaries (`KIMI_BUN_TEST_EXTENDED_IMPORT`).
- Bun also injects globals without import; kimi tests should not rely on globals except in subprocess contract probes.
- API reference: [bun.com/reference/bun/test](https://bun.com/reference/bun/test)

## File naming

Enforced by `scripts/lint-test-names.ts`:

| Pattern                      | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `{stem}.unit.test.ts`        | Fast gate; maps to a source module under `src/`        |
| `{stem}.integration.test.ts` | Full suite only                                        |
| `{stem}.smoke.test.ts`       | CLI smoke (`test/smoke/`)                              |
| `{stem}.db.test.ts`          | Sequential DB tests (excluded from fast parallel glob) |

Top-level `describe("…")` must use **kebab-case** and start with the file stem (or a documented alias in `lint-test-names.ts`). Legacy exemptions are listed in `LEGACY_DESCRIBE_EXEMPT` — do not add new ones.

## Grouping & test names

- Wrap related cases in `describe()` blocks (one top-level describe per file stem).
- Test titles: **intent-first** — `"does X when Y"`, not `"works"` or `"test #1"`.
- Use `test.each` / `describe.each` for parameterized tables.
- Prefer `test` over `it`; both are valid aliases.

## Snapshot tests

Bun supports file snapshots (`toMatchSnapshot()`), inline snapshots (`toMatchInlineSnapshot()`),
and error snapshots (`toThrowErrorMatchingSnapshot()` /
`toThrowErrorMatchingInlineSnapshot()`). Use snapshots sparingly in this repo: they
are best for compact, stable contract output where a diff is easier to review than
many field-by-field assertions.

| Use case                                    | Prefer                                                                 | Avoid                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Small scalar or object contracts            | `toMatchInlineSnapshot()`                                              | Large inline blobs that obscure the test body        |
| Multi-line generated contract output        | `toMatchSnapshot()` plus a committed `__snapshots__/*.snap` file       | Snapshots of entire reports, dashboards, or logs     |
| Dynamic values (paths, timestamps, ids)     | Normalize fields before matching or use property matchers              | Snapshots containing machine-local absolute paths    |
| Error-message contracts                     | `toThrowErrorMatchingInlineSnapshot()` for short messages              | Generic `toThrow()` when the message is the contract |
| Intentional snapshot refresh during a fixup | `bun test <file> --update-snapshots`, then review `git diff` carefully | Blanket snapshot updates across the whole suite      |

Current local exemplar: `test/audit-effects.unit.test.ts` normalizes fixture paths
before `toMatchSnapshot()`, and commits the expected output in
`test/__snapshots__/audit-effects.unit.test.ts.snap`.

Snapshot rules:

- Keep snapshots focused and reviewable; if a snapshot is hard to inspect, replace it with explicit assertions or split the contract.
- Normalize nondeterministic data before matching: timestamps, random ids, absolute paths, map iteration order, process ids, ports, and platform-specific separators.
- Prefer inline snapshots only when the expected value is short enough to make the test clearer.
- Do not use snapshots as a substitute for behavior assertions; assert critical booleans, statuses, and counts directly when they drive control flow.
- When updating snapshots, run the narrowest command first and inspect only the intended `__snapshots__` or inline diff.

## Isolation

1. **HOME** — Preload sets `Bun.env.KIMI_TEST_HOME`; unit tests must not touch real `~/.kimi-code/` or `~/.config/`. Use `withIsolatedHome()` from `test/helpers.ts`.
2. **Env** — Use `withEnv()` / `withClearedEnv()`; never assign `process.env.*` without restoration.
3. **Files** — Tier runners pass `--isolate` so each file gets a clean module graph. Use `afterEach` + `jest.resetModules()` when tests mutate `globalThis` or `Bun.env`.
4. **Temp dirs** — `testTempDir()` / `withTempDir()`; cleanup with `cleanupPath()` in `finally`.
5. **Console** — `captureConsole`, `captureStderrWrite`; do not assign `console.log = …`.

## Stack rules

1. Import test symbols from `"bun:test"` (`BUN_TEST_EXPLICIT_IMPORT` in `test-runtime.ts`).
2. Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`) over Node sync I/O.
3. No `node:fs` / `fs` sync imports in tests (`readFileSync`, `writeFileSync`, `mkdtempSync`).
4. No raw `process.env` — use `Bun.env` or helpers.
5. Smoke tests: `test/smoke/`; invoke via `invokeTool()` wrappers, not ad-hoc `Bun.spawn(["bun", "run", …])`.
6. Async: prefer `async/await`; avoid `done` callbacks unless testing Bun's callback path.

## Helper API

```ts
import {
  REPO_ROOT,
  testTempDir,
  cleanupPath,
  withTempDir,
  withIsolatedHome,
  withEnv,
  withClearedEnv,
  captureConsole,
  captureStderrWrite,
} from "./helpers.ts";
```

Effect tests: `runWithLayer` from `test/effect-helpers.ts`.

## Anti-patterns

| Do not                                          | Use instead                                              |
| ----------------------------------------------- | -------------------------------------------------------- |
| `import { readFileSync } from "node:fs"`        | `Bun.file(path).text()` or `readText()` from `bun-io.ts` |
| `process.env.HOME = …` without restore          | `withIsolatedHome()` / `withEnv()`                       |
| Hardcoded `/tmp/…`                              | `testTempDir()`                                          |
| `console.log = …`                               | `captureConsole()`                                       |
| Top-level tests with no `describe()`            | `describe("<file-stem>", () => { … })`                   |
| `*.test.ts` (no tier suffix) in `test/`         | `*.unit.test.ts` etc.                                    |
| Bare `bun test` in hooks/CI                     | `bun run test:fast` or tier scripts                      |
| CLI `--preload ./test/setup.ts` in tier scripts | `bunfig.toml` `[test].preload`                           |

## Doc audit (agents)

Before editing testing docs, run the gate or the equivalent `rg` recipes (SSOT: `src/lib/testing-docs-lint.ts`).

```bash
bun run scripts/lint-testing-docs.ts          # stale-pattern gate
bun run scripts/lint-testing-docs.ts --report # print rg recipes + bun test inventory
```

Manual inventory (same patterns encoded in `TESTING_DOCS_AUDIT_COMMANDS`):

```bash
rg -n --glob '*.{md,ts}' 'bun test' .

rg -n --glob '*.{md,ts,js,json}' \
  -e 'jest|vitest|mocha|ava|tap|jasmine' \
  -e 'test\(|it\(|describe\(' \
  --ignore-case \
  --no-ignore-vcs \
  -g '!node_modules' -g '!dist' -g '!.git' -g '!pnpm-lock.yaml' -g '!bun.lock' \
  .
```

Heading case and ATX format (`rg` — gate skips lines inside fenced code blocks):

```bash
rg -n '^#{1,6}\s+[a-z]' --glob '*.md' .
rg -n '^#{1,6}\s+.*[.!?]$' --glob '*.md' .
rg -n '^#{1,6}[^ #]' --glob '*.md' .
```

Fence language inventory (repo uses short ids — `ts` not `typescript`):

````bash
rg -n '^```[a-z]+' --glob '*.md' .
````

The gate also cross-checks every `test/**/*.test.ts` against `UNIT_TEST_FILES` / `INTEGRATION_TEST_FILES` / `SMOKE_TEST_FILES` in `test-gates.ts` (orphan or stale tier entries).

Optional deep audit (skipped levels, duplicate headings, trailing spaces, setext vs ATX):

```bash
bunx markdownlint-cli2 '**/*.md' '#node_modules'
```

Gate JSON for agents: `bun run scripts/lint-testing-docs.ts --json` → `{ schemaVersion, tool, ok, issues[] }`.

Markdown dead links (Bun-native — `Bun.markdown.render` + `Bun.file` / `fetch`):

```bash
bun run scripts/lint-markdown-links.ts           # agent docs, internal links only
bun run scripts/lint-markdown-links.ts --full    # + docs/**/*.md, skills/**/SKILL.md
bun run scripts/lint-markdown-links.ts --full --online  # HEAD-check externals (warn)
```

Full `bun run lint` runs `--full` offline; external checks stay opt-in (`lint:links:online`).

Interpretation:

- Bare `bun test` is **allowed** for single-file debug (`bun test <file>`), coverage probes (`bun test --coverage`), and anti-pattern tables — not for hooks/CI (use tier scripts).
- `jest` in docs usually means Bun's `bun:test` Jest-compat namespace (`jest.resetModules()`, `jest.fn`) — not the Jest package.
- Reject `vitest` / `mocha` / `jasmine` in agent-facing markdown unless documenting a migration away from them.
- Heading lowercase / trailing punctuation are **warnings** on agent docs (h1 slug titles like `# kimi-toolchain` are allowed). Missing space after `#` is an **error**.

Render this guide in tooling via [Bun.markdown.html](https://bun.com/docs/runtime/markdown#bun-markdown-html) (`src/lib/bun-markdown.ts` — `markdownHtmlSupported()` / `markdownToHtml()`).

## Bun documentation map

Contracts in `test-runtime.ts` align with these Bun docs:

| Topic                           | Bun doc                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| Runtime env, globals, isolation | [runtime-behavior](https://bun.com/docs/test/runtime-behavior)        |
| Discovery                       | [discovery](https://bun.com/docs/test/discovery)                      |
| `bunfig.toml` `[test]`          | [configuration](https://bun.com/docs/test/configuration)              |
| Writing tests                   | [writing-tests](https://bun.com/docs/test/writing-tests)              |
| Running tests                   | [test#run-tests](https://bun.com/docs/test#run-tests)                 |
| Snapshot testing                | [snapshot](https://bun.com/docs/guides/test/snapshot)                 |
| Updating snapshots              | [update-snapshots](https://bun.com/docs/guides/test/update-snapshots) |
| `bun:test` API                  | [reference/bun/test](https://bun.com/reference/bun/test)              |

### Recommended flag combinations

| Use case             | Command                                                                  | Key flags                           | Notes                                                       |
| -------------------- | ------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| Fast smoke / gate    | `bun test -t serve-probe ./test/portal-convergence.unit.test.ts`         | `-t`, explicit file                 | Best for pre-push and quick checks; avoid `--changed`       |
| Focused watch loop   | `bun test --watch ./test/portal-convergence.unit.test.ts -t serve-probe` | `--watch`, file, `-t`               | Avoid `--changed` for focused work; `--watch` auto-isolates |
| Branch-wide watch    | `bun run test:changed:watch`                                             | `--changed`, `--watch`              | Re-filters on any `.ts` edit; stays alive when no changes   |
| Parallel execution   | `bun test --parallel`                                                    | `--parallel`                        | Good default for most runs; implies `--isolate` per worker  |
| CI shard (job 2/3)   | `bun test --shard=2/3 --parallel --bail`                                 | `--shard`, `--parallel`, `--bail`   | Deterministic round-robin; combine with `--changed` on PRs  |
| Full tier, stop fast | `bun run test:fast -- --bail=1`                                          | `--bail`                            | Tier runner already adds `--isolate --parallel=4`           |
| Reproducible random  | `bun test --seed 12345`                                                  | `--seed`                            | `--seed` implies `--randomize`; same seed = same order      |
| Debug flaky tests    | `bun test --isolate --retry=3 --bail=1 ./test/flaky.test.ts`             | `--isolate`, `--retry`, `--bail`    | Avoid `--parallel` when debugging specific tests            |
| Coverage for CI      | `bun test --coverage --coverage-reporter lcov --parallel`                | `--coverage`, `--coverage-reporter` | Aggregates across parallel workers                          |
| Update snapshots     | `bun test -u ./test/component.test.ts`                                   | `-u` / `--update-snapshots`         | Only run on files you intend to update                      |

Code constants: `BUN_TEST_FLAG_INTERACTIONS` (16 compositions) and `BUN_TEST_RECOMMENDED_COMBINATIONS` (7 workflows) in `src/lib/test-runtime.ts`.

> **Defaults:** When flags are omitted, Bun uses these defaults: `--timeout=5000`, `--bail=1` (when passed), `--max-concurrency=20`, `--reporter=console`, `--coverage-reporter=text`, `--coverage-dir=coverage`. See `BUN_TEST_DEFAULTS` in `test-runtime.ts`.

## Example patterns

### Temp directory with cleanup

```ts
test("writes project file", async () => {
  await withTempDir("project", async (dir) => {
    const path = join(dir, "package.json");
    await Bun.write(path, JSON.stringify({ name: "x" }));
    expect(await Bun.file(path).json()).toEqual({ name: "x" });
  });
});
```

### Isolated HOME

```ts
test("uses isolated kimi-code home", async () => {
  await withIsolatedHome(async (home) => {
    const toolsDir = join(home, ".kimi-code", "tools");
    ensureTestDir(toolsDir);
    // ...
  });
});
```

### Mock at boundary

```ts
import { mock } from "bun:test";

test("fetches data", async () => {
  const fetchMock = mock(() => Promise.resolve(new Response("ok")));
  const prior = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await fetchData();
    expect(fetchMock).toHaveBeenCalled();
  } finally {
    globalThis.fetch = prior;
  }
});
```
