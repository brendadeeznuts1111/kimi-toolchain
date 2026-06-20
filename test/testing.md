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

### Timeouts

| Tier                          | Per-test timeout | Constant                      |
| ----------------------------- | ---------------- | ----------------------------- |
| Fast unit gate                | 1,500 ms         | `FAST_TEST_TIMEOUT_MS`        |
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

Interpretation:

- Bare `bun test` is **allowed** for single-file debug (`bun test <file>`), coverage probes (`bun test --coverage`), and anti-pattern tables — not for hooks/CI (use tier scripts).
- `jest` in docs usually means Bun's `bun:test` Jest-compat namespace (`jest.resetModules()`, `jest.fn`) — not the Jest package.
- Reject `vitest` / `mocha` / `jasmine` in agent-facing markdown unless documenting a migration away from them.

Render this guide in tooling via [Bun.markdown.html](https://bun.com/docs/runtime/markdown#bun-markdown-html) (`src/lib/bun-markdown.ts` — `markdownHtmlSupported()` / `markdownToHtml()`).

## Bun documentation map

Contracts in `test-runtime.ts` align with these Bun docs:

| Topic                           | Bun doc                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| Runtime env, globals, isolation | [runtime-behavior](https://bun.com/docs/test/runtime-behavior) |
| Discovery                       | [discovery](https://bun.com/docs/test/discovery)               |
| `bunfig.toml` `[test]`          | [configuration](https://bun.com/docs/test/configuration)       |
| Writing tests                   | [writing-tests](https://bun.com/docs/test/writing-tests)       |
| Running tests                   | [test#run-tests](https://bun.com/docs/test#run-tests)          |
| `bun:test` API                  | [reference/bun/test](https://bun.com/reference/bun/test)       |

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
