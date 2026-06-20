# Testing Conventions — kimi-toolchain

> Bun-native test discipline for the `kimi-toolchain` repo.

## Stack

- **Runner**: `bun:test` (built into Bun)
- **Entry**: `bun run test:fast` for the fast unit gate, `bun test` for full discovery
- **Preload**: `test/setup.ts` runs before every test file; `scripts/run-tests.ts` injects it as an absolute `--preload` so isolate workers under concurrent load can resolve it
- **Helpers**: `test/helpers.ts` for shared, Bun-native test utilities

## Golden rules

1. **Import test symbols from `"bun:test"`** (explicit imports preferred over Bun globals)

   ```ts
   import {
     test,
     it,
     describe,
     expect,
     beforeAll,
     beforeEach,
     afterAll,
     afterEach,
     jest,
     vi,
     mock,
   } from "bun:test";
   ```

2. **Prefer Bun APIs over Node APIs**
   - `Bun.file(path).text()` / `.json()` instead of `readFileSync`
   - `Bun.write(path, data)` instead of `writeFileSync`
   - `Bun.spawn`, `Bun.spawnSync` instead of `child_process`
   - Use `test/helpers.ts` wrappers for directory lifecycle.

3. **No direct `node:fs` / `node:os` / `node:path` imports in tests**
   - Use `"path"`, `"os"` standard imports when no Bun equivalent exists.
   - Use helpers from `test/helpers.ts` and `src/lib/bun-io.ts` for file I/O.

4. **Isolate mutable state**
   - Unit tests must not touch the real `~/.kimi-code/` or `~/.config/`.
   - Use `withIsolatedHome()` or set `Bun.env.HOME` to `Bun.env.KIMI_TEST_HOME`.
   - Restore environment in `afterEach` or `finally`.

5. **Clean up temp resources**
   - Use `withTempDir()` for automatic cleanup.
   - If manual, delete in `afterEach` or `finally` using `cleanupPath()`.

6. **Use `mock` and `spy` for boundaries**
   - Prefer `mock()` over monkey-patching globals.
   - Use `spyOn` for partial mocks.

7. **Test structure**
   - Group related tests in `describe()` blocks.
   - Name tests with explicit intent: `"does X when Y"`.
   - Use `test.each` / `describe.each` for parameterized cases.

8. **Async tests**
   - Prefer `async/await` over callback chains.
   - Return Promises from `test()` callbacks.

9. **Smoke tests**
   - Keep smoke tests in `test/smoke/`.
   - Use `invokeTool()` or wrapper CLIs, not raw `Bun.spawn(["bun", "run", ...])`.
   - Avoid `process.exit()` inside smoke tests.

10. **Timing**
    - Fast unit gate target: 1,500ms per test.
    - Default timeout: 30s; smoke tests may use 60s.
    - Set per-test timeout only when the operation genuinely needs it.

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
  withTelemetryHome,
  clearSessionEnv,
  captureConsole,
  captureConsoleError,
  captureStdout,
  captureStderr,
  captureStderrWrite,
  readJson,
  writeJson,
  ensureTestDir,
  pathExists,
  readText,
  writeText,
} from "./helpers.ts";
```

Effect tests use `runWithLayer` from `test/effect-helpers.ts`:

```ts
import { runWithLayer } from "../effect-helpers.ts";
import { ConstantsRegistryLive } from "../../src/lib/constants-registry.ts";

const result = await runWithLayer(program, ConstantsRegistryLive(dir));
```

## Example patterns

### Temp directory with automatic cleanup

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
test("uses ~/.kimi-code/tools", async () => {
  await withIsolatedHome(async (home) => {
    const toolsDir = join(home, ".kimi-code", "tools");
    ensureTestDir(toolsDir);
    // ...
  });
});
```

### Capture console output

```ts
test("logs greeting", async () => {
  const lines = await captureConsole(() => greet("world"));
  expect(lines).toContain("hello world");
});
```

### Mock a dependency

```ts
import { mock } from "bun:test";

test("fetches data", async () => {
  const fetchMock = mock(() => Promise.resolve(new Response("ok")));
  globalThis.fetch = fetchMock;
  try {
    await fetchData();
    expect(fetchMock).toHaveBeenCalled();
  } finally {
    globalThis.fetch = globalThis.fetch; // restore if needed
  }
});
```

## Anti-patterns

- `import { readFileSync } from "node:fs"` — use `Bun.file` or `readText`.
- `Bun.spawnSync(["rm", "-rf", dir])` — use `cleanupPath(dir)`.
- `process.env.HOME = ...` without restoration — use `withIsolatedHome` or `withEnv`.
- Hardcoded `/tmp/...` paths — use `testTempDir`.
- Compact herdr pane ids (`1-1`) in assertions — use stable handles or live ids.
- `console.log = ...` monkey-patching — use `captureConsole`.
