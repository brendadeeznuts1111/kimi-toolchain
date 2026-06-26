# Bunfig configuration reference

Manifest id: `bunfig-config` · repo: `docs/references/bunfig-config.md` · runtime: `~/.kimi-code/docs/references/bunfig-config.md`

Quick reference for `bunfig.toml` fields that affect the Bun runtime, test runner, `bun run`, and `Bun.serve`. For package-manager settings see [Bun runtime scaffold flags](./bun-runtime-scaffold.md).

## Scope and loading order

`bunfig.toml` is optional. Bun already uses `package.json`, `tsconfig.json`, and environment variables where possible.

| Scope         | Path                                                    | Notes                                           |
| ------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Project-local | `<project>/bunfig.toml`                                 | Shallow-merged with global; local wins.         |
| Global        | `$HOME/.bunfig.toml` or `$XDG_CONFIG_HOME/.bunfig.toml` | Useful for machine-wide defaults.               |
| CLI flags     | e.g. `--config <path>`                                  | Override `bunfig.toml` values where applicable. |

## Top-level runtime fields

| Field             | Type                           | Description                                                                       |
| ----------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `preload`         | `string[]`                     | Scripts/plugins to execute before `bun run` or running a file.                    |
| `jsx`             | `string`                       | JSX runtime: `"react"`, `"react-jsx"`, `"react-native"`, `"solid"`, `"preserve"`. |
| `jsxFactory`      | `string`                       | Custom JSX factory, e.g. `"h"`.                                                   |
| `jsxFragment`     | `string`                       | Custom JSX fragment, e.g. `"Fragment"`.                                           |
| `jsxImportSource` | `string`                       | Module for automatic JSX runtime imports, e.g. `"react"`.                         |
| `smol`            | `boolean`                      | Reduce memory usage at the cost of performance.                                   |
| `logLevel`        | `"debug" \| "warn" \| "error"` | Runtime log verbosity.                                                            |
| `telemetry`       | `boolean`                      | Enable/disable anonymous crash reporting. Default `true`.                         |
| `env`             | `boolean \| { file: boolean }` | Automatic `.env` loading. Set `false` to disable.                                 |

### Macros and loaders

```toml
[define]
"process.env.BUILD_ID" = "'abc123'"

[loader]
".bagel" = "tsx"
```

| Section    | Purpose                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `[define]` | Replace global identifiers with JSON expressions at parse time.                                                                            |
| `[loader]` | Map file extensions to Bun loaders (`js`, `ts`, `tsx`, `jsx`, `css`, `file`, `json`, `toml`, `wasm`, `napi`, `base64`, `dataurl`, `text`). |

### Console

```toml
[console]
depth = 3
```

| Field           | Type     | Default | Description                                                                        |
| --------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `console.depth` | `number` | `2`     | Default `console.log` object-inspection depth. Overridable with `--console-depth`. |

## Serve

```toml
[serve]
port = 3000
```

| Field        | Type     | Default | Description                                                                       |
| ------------ | -------- | ------- | --------------------------------------------------------------------------------- |
| `serve.port` | `number` | `3000`  | Default port for `Bun.serve`. Also controlled by `BUN_PORT` / `PORT` or `--port`. |

## Test runner

```toml
[test]
root = "./test"
preload = ["./test/setup.ts"]
coverage = true
randomize = true
```

| Field                             | Type                 | Description                                    |
| --------------------------------- | -------------------- | ---------------------------------------------- |
| `test.root`                       | `string`             | Root directory for test discovery. Default `.` |
| `test.preload`                    | `string[]`           | Preload scripts applied only to `bun test`.    |
| `test.pathIgnorePatterns`         | `string[]`           | Glob patterns to exclude from test discovery.  |
| `test.smol`                       | `boolean`            | Enable `smol` mode for tests only.             |
| `test.coverage`                   | `boolean`            | Enable coverage. Default `false`.              |
| `test.coverageThreshold`          | `number \| object`   | Line/function/statement threshold.             |
| `test.coverageSkipTestFiles`      | `boolean`            | Exclude test files from coverage stats.        |
| `test.coverageIgnoreSourcemaps`   | `boolean`            | Report against transpiled output.              |
| `test.coveragePathIgnorePatterns` | `string \| string[]` | Files/patterns to exclude from coverage.       |
| `test.coverageReporter`           | `string[]`           | Reporters, e.g. `["text", "lcov"]`.            |
| `test.coverageDir`                | `string`             | Directory for persistent coverage reports.     |
| `test.randomize`                  | `boolean`            | Run tests in random order.                     |
| `test.seed`                       | `number`             | Reproducible randomization seed.               |
| `test.rerunEach`                  | `number`             | Re-run each test file N times.                 |
| `test.retry`                      | `number`             | Default retry count for failing tests.         |
| `test.concurrentTestGlob`         | `string`             | Glob pattern for files to run concurrently.    |
| `test.onlyFailures`               | `boolean`            | Show only failed tests in output.              |
| `test.reporter.dots`              | `boolean`            | Enable compact dots reporter.                  |
| `test.reporter.junit`             | `string`             | Path for JUnit XML output.                     |

## `bun run`

```toml
[run]
shell = "system"
bun = true
silent = true
elide-lines = 10
noOrphans = true
```

| Field             | Type                | Default                              | Description                                                                |
| ----------------- | ------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `run.shell`       | `"system" \| "bun"` | `"system"` (Unix), `"bun"` (Windows) | Shell used for package.json scripts.                                       |
| `run.bun`         | `boolean`           | `true` if `node` not in `PATH`       | Alias `node` to `bun` for scripts. Equivalent to `--bun`.                  |
| `run.silent`      | `boolean`           | `false`                              | Suppress "Running ..." output. Equivalent to `--silent`.                   |
| `run.elide-lines` | `number`            | `10`                                 | Lines shown per script with `--filter`. `0` shows all.                     |
| `run.noOrphans`   | `boolean`           | `false`                              | Kill descendant processes when parent exits. Equivalent to `--no-orphans`. |

## Related

| Topic                             | Path                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| Install/package-manager settings  | [bun-runtime-scaffold.md](./bun-runtime-scaffold.md)        |
| Configuration layers in this repo | [configuration-layers.md](./configuration-layers.md)        |
| Bun upstream reference            | [Bun runtime / bunfig](https://bun.com/docs/runtime/bunfig) |
