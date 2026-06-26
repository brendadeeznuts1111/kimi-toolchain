# Bun test API reference

This doc summarises the built-in test runner API that `kimi-toolchain` uses via
`bun:test`. It is intended as a quick reference for writing, organising, and
auditing tests.

## Entry point

Tests are run with the `bun test` CLI. Bun discovers files matching the default
patterns (`*.test.{js,ts,jsx,tsx}` and `*.spec.{js,ts,jsx,tsx}`) unless the
`[test]` table in `bunfig.toml` changes the defaults.

```bash
bun test
bun test --coverage
bun test --timeout 30000
bun test --bail
bun test path/to/file.unit.test.ts
```

## Importing the test API

```ts
import {
  describe,
  it,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
```

## Test organisation

### `describe(name, fn)`

Groups related tests. `describe` blocks can be nested.

```ts
describe("lib/utils", () => {
  describe("parseVersion", () => {
    it("accepts semver", () => { ... });
    it("rejects garbage", () => { ... });
  });
});
```

### `it(name, fn)` and `test(name, fn)`

Aliases for a single test case. Use `it.skip`, `it.todo`, and `it.only` for
focus modes.

```ts
it("adds two numbers", () => {
  expect(1 + 1).toBe(2);
});

test.skip("flaky network case", async () => { ... });
```

## Lifecycle hooks

| Hook             | Runs                                                   |
| ---------------- | ------------------------------------------------------ |
| `beforeAll(fn)`  | Once before all tests in the current `describe` block. |
| `beforeEach(fn)` | Before each test in the current `describe` block.      |
| `afterAll(fn)`   | Once after all tests in the current `describe` block.  |
| `afterEach(fn)`  | After each test in the current `describe` block.       |

Hooks support async functions and `async`/`await`.

## Matchers

Bun supports Jest-compatible matchers:

- Equality: `toBe`, `toEqual`, `toStrictEqual`
- Truthiness: `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`
- Numbers: `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeCloseTo`
- Strings/arrays: `toContain`, `toHaveLength`, `toMatch` (regex)
- Objects: `toHaveProperty`, `toMatchObject`
- Errors: `toThrow`, `toThrowError`
- Asymmetric: `expect.any(String)`, `expect.anything()`, `expect.objectContaining(...)`

```ts
expect(result).toEqual({ name: "bun", version: expect.any(String) });
expect(() => risky()).toThrow("boom");
```

## Async testing

Return a promise or use `async`/`await`:

```ts
it("reads a file", async () => {
  const text = await Bun.file("fixture.txt").text();
  expect(text).toContain("hello");
});
```

## Mocking

### `mock(fn?)`

Creates a spy function.

```ts
const fn = mock((x: number) => x * 2);
fn(3);
expect(fn).toHaveBeenCalledTimes(1);
expect(fn).toHaveBeenCalledWith(3);
```

### `spyOn(object, method)`

Spies on an existing method. Bun 1.4.0+ supports `using` so the spy is
automatically restored when the block exits:

```ts
it("tracks calls", () => {
  using spy = spyOn(console, "log");
  console.log("hello");
  expect(spy).toHaveBeenCalledWith("hello");
});
```

## Snapshots

Use `toMatchSnapshot` to capture serialised values:

```ts
it("renders manifest", () => {
  const manifest = buildManifest();
  expect(manifest).toMatchSnapshot();
});
```

Update snapshots with:

```bash
bun test --update-snapshots
```

Snapshot files live in `test/__snapshots__/` and are committed.

## Coverage

Run tests with coverage:

```bash
bun test --coverage
```

The report is printed to the terminal. `kimi-toolchain` does not currently fail
gates on coverage percentage, but coverage is collected in CI for trend
analysis.

## Test runner configuration

Key `[test]` keys in `bunfig.toml`:

| Key                 | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `preload`           | Modules to load before each test file.        |
| `root`              | Directory to scan for test files.             |
| `coverage`          | Enable coverage by default.                   |
| `coverageThreshold` | Fail when coverage drops below the threshold. |
| `testNamePattern`   | Run only tests matching the pattern.          |
| `silent`            | Suppress console output during tests.         |

See `docs/references/bunfig-config.md` for the full `[test]` table reference.

## Anti-patterns to avoid

- Do not import from `node:test` or `vitest` in `kimi-toolchain` tests; use
  `bun:test` exclusively.
- Avoid side effects at module load time; use `beforeAll`/`beforeEach`.
- Do not commit `.snap` files that contain absolute paths or timestamps unless
  the serialiser normalises them.

## Related docs

- `docs/references/testing-execution.md` for the four-script test execution model.
- `docs/references/bunfig-config.md` for `[test]` configuration keys.
- `docs/references/bun-runtime-scaffold.md` for Bun APIs used inside tests.
