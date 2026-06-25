# Bun CLI Completion Behavior Matrix

Generated from `completions/bun-cli.json` (schema v1.2.0, Bun 1.4.0, hash `5a2cd016`).

## Top-level commands

| Command | Flags | Value flags | Positional args | Req pos | Opt pos | File I/O | PM | Runtime | Debug | Network | Subcommands | Dynamic | Examples | Defaults (#) | Default values | Choices (#) | Choice values | Drift hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| add (a) | 40 | 14 | 1 | 0 | 1 | 4 | 28 | 1 | 5 | 6 | 0 | packages | 6 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| audit | 3 | 2 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | — | 2 | 0 | — | 0 | — | 5a2cd016 |
| build | 57 | 27 | 0 | 0 | 0 | 13 | 1 | 6 | 1 | 0 | 0 | files | 5 | 12 | --compile-autoload-dotenv=true), --compile-autoload-bunfig=true), --compile-autoload-tsconfig=false), --compile-autoload-package-json=false), --outdir=dist, --format=esm, --allow-unresolved='*', --packages=bundle, --entry-naming=[dir]/[name], --chunk-naming=[name]-[hash], --asset-naming=[name]-[hash], --env='disable' | 0 | — | 5a2cd016 |
| create (c) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | 0 | — | 0 | — | 5a2cd016 |
| exec | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 2 | 0 | — | 0 | — | 5a2cd016 |
| feedback | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | 0 | — | 0 | — | 5a2cd016 |
| info | 35 | 14 | 2 | 0 | 2 | 4 | 23 | 1 | 5 | 6 | 0 | — | 3 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| init | 6 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | — | 4 | 0 | — | 0 | — | 5a2cd016 |
| install (i) | 41 | 15 | 1 | 0 | 1 | 4 | 28 | 2 | 5 | 6 | 0 | — | 2 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| link | 34 | 14 | 1 | 0 | 1 | 4 | 23 | 1 | 5 | 6 | 0 | — | 2 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| outdated | 36 | 15 | 2 | 0 | 2 | 4 | 23 | 2 | 5 | 6 | 0 | — | 7 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| patch | 36 | 15 | 1 | 0 | 1 | 4 | 23 | 1 | 5 | 6 | 0 | — | 3 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| pm | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 16 | — | 0 | 0 | — | 0 | — | 5a2cd016 |
| publish | 40 | 19 | 2 | 0 | 2 | 4 | 26 | 1 | 5 | 7 | 0 | — | 4 | 4 | --concurrent-scripts=2x, --tag=latest, --auth-type='web'), --gzip-level=9 | 0 | — | 5a2cd016 |
| remove (rm) | 34 | 14 | 1 | 0 | 1 | 4 | 23 | 1 | 5 | 6 | 0 | packages | 1 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| repl | 82 | 42 | 2 | 1 | 1 | 5 | 2 | 19 | 5 | 2 | 0 | — | 4 | 7 | --elide-lines=10), --cpu-prof-interval=1000), --max-http-header-size=16KiB, --console-depth=2), --main-fields=--target, --extension-order=:, --jsx-import-source=react | 3 | --install={auto}, --dns-result-order={verbatim, (default), ipv4first, ipv6first}, --unhandled-rejections={strict} | 5a2cd016 |
| run | 82 | 42 | 2 | 1 | 1 | 5 | 2 | 19 | 5 | 2 | 0 | scripts, files, binaries | 4 | 7 | --elide-lines=10), --cpu-prof-interval=1000), --max-http-header-size=16KiB, --console-depth=2), --main-fields=--target, --extension-order=:, --jsx-import-source=react | 3 | --install={auto}, --dns-result-order={verbatim, (default), ipv4first, ipv6first}, --unhandled-rejections={strict} | 5a2cd016 |
| test | 28 | 16 | 2 | 0 | 2 | 0 | 0 | 2 | 4 | 1 | 0 | files | 3 | 7 | --timeout=5000, --coverage-reporter='text', --coverage-dir='coverage', --bail=1, --reporter=console, --max-concurrency=20, --parallel=CPU | 0 | — | 5a2cd016 |
| unlink | 34 | 14 | 1 | 0 | 1 | 4 | 23 | 1 | 5 | 6 | 0 | — | 1 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| update | 38 | 15 | 1 | 0 | 1 | 4 | 23 | 2 | 5 | 6 | 0 | — | 4 | 1 | --concurrent-scripts=2x | 0 | — | 5a2cd016 |
| upgrade | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | — | 2 | 0 | — | 0 | — | 5a2cd016 |
| why | 0 | 0 | 3 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | 0 | — | 0 | — | 5a2cd016 |
| x | 5 | 0 | 3 | 1 | 2 | 0 | 1 | 1 | 2 | 0 | 0 | — | 0 | 0 | — | 0 | — | 5a2cd016 |

## `bun pm` subcommands

| Path | Flags | Value flags | Positional args | Req pos | Opt pos | File I/O | PM | Runtime | Debug | Network | Subcommands | Examples | Defaults (#) | Default values | Choices (#) | Choice values | Isolated | Drift hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pm scan | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pack | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm bin | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm why | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm whoami | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm view | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm version | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pkg | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pkg get | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pkg set | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pkg delete | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm pkg fix | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm hash | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm hash-string | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm hash-print | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm cache | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm cache rm | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm migrate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm untrusted | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm trust | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |
| pm default-trusted | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 | — | Yes | 5a2cd016 |

## Global flag inheritance by command

| Command | Inherits global | Own flags | Total surface | Isolated | Critical inherited |
| --- | --- | --- | --- | --- | --- |
| add | 84 | 40 | 124 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| audit | 84 | 3 | 87 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| build | 84 | 57 | 141 | No | `hot`, `env-file`, `preload`, `inspect` |
| create | 84 | 0 | 84 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| exec | 84 | 0 | 84 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| feedback | 84 | 0 | 84 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| info | 84 | 35 | 119 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| init | 84 | 6 | 90 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| install | 84 | 41 | 125 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| link | 84 | 34 | 118 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| outdated | 84 | 36 | 120 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| patch | 84 | 36 | 120 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| pm | — | 0 | 0 | Yes | — |
| publish | 84 | 40 | 124 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| remove | 84 | 34 | 118 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| repl | 84 | 82 | 166 | No | — |
| run | 84 | 82 | 166 | No | — |
| test | 84 | 28 | 112 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| unlink | 84 | 34 | 118 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| update | 84 | 38 | 122 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| upgrade | 84 | 0 | 84 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| why | 84 | 0 | 84 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |
| x | 84 | 5 | 89 | No | `watch`, `hot`, `env-file`, `preload`, `inspect` |

## Global flags

- Total: 84
- With values: 42
- With defaults: 7
- With choices: 3

## Special handling

| Scenario | Behavior |
| --- | --- |
| Bare `bun` | Runs files, scripts, and binaries |
| `bun run` | Completes scripts, files, and binaries |
| `bun add` | Completes registry packages |
| `bun remove` | Completes installed packages |
| `bun create` | Completes templates |
| `bun test` / `bun build` | Completes files |

## `bun getcompletes`

Available: Yes

| Provider | Command |
| --- | --- |
| Scripts | `bun getcompletes s` |
| Binaries | `bun getcompletes b` |
| Packages | `bun getcompletes a` |
| Files | `bun getcompletes j` |

## Detailed command breakdowns

### `bun pm version`

*No positional arguments.*

### `bun pm pkg set`

*No positional arguments.*

### `bun pm pkg get`

*No positional arguments.*

### `bun pm pkg delete`

*No positional arguments.*

### `bun install` flag defaults

| Flag | Has value | Value type | Default | Choices | Categories | Description |
| --- | --- | --- | --- | --- | --- | --- |
| -c, --config | Yes | val | — | — | fileIO | Specify path to config file (bunfig.toml) |
| -y, --yarn | No | — | — | — | pm | Write a yarn.lock file (yarn v1) |
| -p, --production | No | — | — | — | pm | Don't install devDependencies |
| --no-save | No | — | — | — | pm | Don't update package.json or save a lockfile |
| --save | No | — | — | — | pm | Save to package.json (true by default) |
| --ca | Yes | val | — | — | network | Provide a Certificate Authority signing certificate |
| --cafile | Yes | val | — | — | fileIO, network | The same as `--ca`, but is a file path to the certificate |
| --dry-run | No | — | — | — | pm | Perform a dry run without making changes |
| --frozen-lockfile | No | — | — | — | pm | Disallow changes to lockfile |
| -f, --force | No | — | — | — | pm | Always request the latest versions from the registry & reinstall all dependencies |
| --cache-dir | Yes | val | — | — | fileIO | Store & load cached data from a specific directory path |
| --no-cache | No | — | — | — | pm, network | Ignore manifest cache entirely |
| --silent | No | — | — | — | debug | Don't log anything |
| --quiet | No | — | — | — | debug | Only show tarball name when packing |
| --verbose | No | — | — | — | debug | Excessively verbose logging |
| --no-progress | No | — | — | — | pm, debug | Disable the progress bar |
| --no-summary | No | — | — | — | pm, debug | Don't print a summary |
| --no-verify | No | — | — | — | pm, network | Skip verifying integrity of newly downloaded packages |
| --ignore-scripts | No | — | — | — | pm | Skip lifecycle scripts in the project's package.json (dependency scripts are never run) |
| --trust | No | — | — | — | pm | Add to trustedDependencies in the project's package.json and install the package(s) |
| -g, --global | No | — | — | — | pm | Install globally |
| --cwd | Yes | val | — | — | fileIO, runtime | Set a specific cwd |
| --backend | Yes | val | — | — | pm | Platform-specific optimizations for installing dependencies. Possible values: "clonefile" (default), "hardlink", "symlink", "copyfile" |
| --registry | Yes | val | — | — | pm, network | Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables |
| --concurrent-scripts | Yes | val | 2x | — | pm | Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores) |
| --network-concurrency | Yes | val | — | — | pm, network | Maximum number of concurrent network requests (default 48) |
| --save-text-lockfile | No | — | — | — | pm | Save a text-based lockfile |
| --omit | Yes | val | — | — | pm | Exclude 'dev', 'optional', or 'peer' dependencies from install |
| --lockfile-only | No | — | — | — | pm | Generate a lockfile without installing dependencies |
| --linker | Yes | val | — | — | pm | Linker strategy (one of "isolated" or "hoisted") |
| --minimum-release-age | Yes | val | — | — | pm | Only install packages published at least N seconds ago (security feature) |
| --cpu | Yes | val | — | — | uncategorized | Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all) |
| --os | Yes | val | — | — | uncategorized | Override operating system for optional dependencies (e.g., linux, darwin, * for all) |
| -h, --help | No | — | — | — | uncategorized | Print this help menu |
| -d, --dev | No | — | — | — | pm | Add dependency to "devDependencies" |
| --optional | No | — | — | — | pm | Add dependency to "optionalDependencies" |
| --peer | No | — | — | — | pm | Add dependency to "peerDependencies" |
| -E, --exact | No | — | — | — | pm | Add the exact version instead of the ^range |
| --filter | Yes | val | — | — | runtime | Install packages for the matching workspaces |
| -a, --analyze | No | — | — | — | uncategorized | Analyze & install all dependencies of files passed as arguments recursively (using Bun's bundler) |
| --only-missing | No | — | — | — | pm | Only add dependencies to package.json if they are not already present |

### `bun add` flag defaults

| Flag | Has value | Value type | Default | Choices | Categories | Description |
| --- | --- | --- | --- | --- | --- | --- |
| -c, --config | Yes | val | — | — | fileIO | Specify path to config file (bunfig.toml) |
| -y, --yarn | No | — | — | — | pm | Write a yarn.lock file (yarn v1) |
| -p, --production | No | — | — | — | pm | Don't install devDependencies |
| --no-save | No | — | — | — | pm | Don't update package.json or save a lockfile |
| --save | No | — | — | — | pm | Save to package.json (true by default) |
| --ca | Yes | val | — | — | network | Provide a Certificate Authority signing certificate |
| --cafile | Yes | val | — | — | fileIO, network | The same as `--ca`, but is a file path to the certificate |
| --dry-run | No | — | — | — | pm | Perform a dry run without making changes |
| --frozen-lockfile | No | — | — | — | pm | Disallow changes to lockfile |
| -f, --force | No | — | — | — | pm | Always request the latest versions from the registry & reinstall all dependencies |
| --cache-dir | Yes | val | — | — | fileIO | Store & load cached data from a specific directory path |
| --no-cache | No | — | — | — | pm, network | Ignore manifest cache entirely |
| --silent | No | — | — | — | debug | Don't log anything |
| --quiet | No | — | — | — | debug | Only show tarball name when packing |
| --verbose | No | — | — | — | debug | Excessively verbose logging |
| --no-progress | No | — | — | — | pm, debug | Disable the progress bar |
| --no-summary | No | — | — | — | pm, debug | Don't print a summary |
| --no-verify | No | — | — | — | pm, network | Skip verifying integrity of newly downloaded packages |
| --ignore-scripts | No | — | — | — | pm | Skip lifecycle scripts in the project's package.json (dependency scripts are never run) |
| --trust | No | — | — | — | pm | Add to trustedDependencies in the project's package.json and install the package(s) |
| -g, --global | No | — | — | — | pm | Install globally |
| --cwd | Yes | val | — | — | fileIO, runtime | Set a specific cwd |
| --backend | Yes | val | — | — | pm | Platform-specific optimizations for installing dependencies. Possible values: "clonefile" (default), "hardlink", "symlink", "copyfile" |
| --registry | Yes | val | — | — | pm, network | Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables |
| --concurrent-scripts | Yes | val | 2x | — | pm | Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores) |
| --network-concurrency | Yes | val | — | — | pm, network | Maximum number of concurrent network requests (default 48) |
| --save-text-lockfile | No | — | — | — | pm | Save a text-based lockfile |
| --omit | Yes | val | — | — | pm | Exclude 'dev', 'optional', or 'peer' dependencies from install |
| --lockfile-only | No | — | — | — | pm | Generate a lockfile without installing dependencies |
| --linker | Yes | val | — | — | pm | Linker strategy (one of "isolated" or "hoisted") |
| --minimum-release-age | Yes | val | — | — | pm | Only install packages published at least N seconds ago (security feature) |
| --cpu | Yes | val | — | — | uncategorized | Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all) |
| --os | Yes | val | — | — | uncategorized | Override operating system for optional dependencies (e.g., linux, darwin, * for all) |
| -h, --help | No | — | — | — | uncategorized | Print this help menu |
| -d, --dev | No | — | — | — | pm | Add dependency to "devDependencies" |
| --optional | No | — | — | — | pm | Add dependency to "optionalDependencies" |
| --peer | No | — | — | — | pm | Add dependency to "peerDependencies" |
| -E, --exact | No | — | — | — | pm | Add the exact version instead of the ^range |
| -a, --analyze | No | — | — | — | uncategorized | Recursively analyze & install dependencies of files passed as arguments (using Bun's bundler) |
| --only-missing | No | — | — | — | pm | Only add dependencies to package.json if they are not already present |

### `bun test` flag defaults

| Flag | Has value | Value type | Default | Choices | Categories | Description |
| --- | --- | --- | --- | --- | --- | --- |
| --no-orphans | No | — | — | — | runtime | Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only. |
| --timeout | Yes | val | 5000 | — | network | Set the per-test timeout in milliseconds, default is 5000. |
| -u, --update-snapshots | No | — | — | — | uncategorized | Update snapshot files |
| --rerun-each | Yes | val | — | — | uncategorized | Re-run each test file  times, helps catch certain bugs |
| --retry | Yes | val | — | — | uncategorized | Default retry count for all tests, overridden by per-test { retry: N } |
| --todo | No | — | — | — | uncategorized | Include tests that are marked with "test.todo()" |
| --only | No | — | — | — | uncategorized | Run only tests that are marked with "test.only()" or "describe.only()" |
| --pass-with-no-tests | No | — | — | — | uncategorized | Exit with code 0 when no tests are found |
| --concurrent | No | — | — | — | uncategorized | Treat all tests as `test.concurrent()` tests |
| --randomize | No | — | — | — | uncategorized | Run tests in random order |
| --seed | Yes | val | — | — | uncategorized | Set the random seed for test randomization |
| --coverage | No | — | — | — | debug | Generate a coverage profile |
| --coverage-reporter | Yes | val | 'text' | — | debug | Report coverage in 'text' and/or 'lcov'. Defaults to 'text'. |
| --coverage-dir | Yes | val | 'coverage' | — | debug | Directory for coverage files. Defaults to 'coverage'. |
| --bail | Yes | val | 1 | — | uncategorized | Exit the test suite after  failures. If you do not specify a number, it defaults to 1. |
| -t, --test-name-pattern | Yes | val | — | — | uncategorized | Run only tests with a name that matches the given regex. |
| --reporter | Yes | val | console | — | uncategorized | Test output reporter format. Available: 'junit' (requires --reporter-outfile), 'dots'. Default: console output. |
| --reporter-outfile | Yes | val | — | — | uncategorized | Output file path for the reporter format (required with --reporter). |
| --dots | No | — | — | — | uncategorized | Enable dots reporter. Shorthand for --reporter=dots. |
| --only-failures | No | — | — | — | debug | Only display test failures, hiding passing tests. |
| --max-concurrency | Yes | val | 20 | — | uncategorized | Maximum number of concurrent tests to execute at once. Default is 20. |
| --path-ignore-patterns | Yes | val | — | — | uncategorized | Glob patterns for test file paths to ignore. |
| --changed | Yes | val | — | — | uncategorized | Only run test files affected by changed files according to git. Optionally pass a commit or branch to compare against. |
| --isolate | No | — | — | — | uncategorized | Run each test file in a fresh global object. Leaked handles from one file cannot affect another. |
| --parallel | Yes | val | CPU | — | runtime | Run test files in parallel using N worker processes. Implies --isolate. Defaults to CPU core count. |
| --parallel-delay | Yes | val | — | — | uncategorized | Milliseconds the first --parallel worker must be busy before spawning the rest. 0 spawns all immediately. Default 5. |
| --test-worker | No | — | — | — | uncategorized | (internal) Run as a --parallel worker, receiving files over IPC. |
| --shard | Yes | val | — | — | uncategorized | Run a subset of test files, e.g. '--shard=1/3' runs the first of three shards. Useful for splitting tests across multiple CI jobs. |

### `bun build` flag defaults

| Flag | Has value | Value type | Default | Choices | Categories | Description |
| --- | --- | --- | --- | --- | --- | --- |
| --production | No | — | — | — | pm | Set NODE_ENV=production and enable minification |
| --compile | No | — | — | — | uncategorized | Generate a standalone Bun executable containing your bundled code. Implies --production |
| --compile-exec-argv | Yes | val | — | — | uncategorized | Prepend arguments to the standalone executable's execArgv |
| --compile-autoload-dotenv | No | — | true) | — | uncategorized | Enable autoloading of .env files in standalone executable (default: true) |
| --no-compile-autoload-dotenv | No | — | — | — | uncategorized | Disable autoloading of .env files in standalone executable |
| --compile-autoload-bunfig | No | — | true) | — | uncategorized | Enable autoloading of bunfig.toml in standalone executable (default: true) |
| --no-compile-autoload-bunfig | No | — | — | — | uncategorized | Disable autoloading of bunfig.toml in standalone executable |
| --compile-autoload-tsconfig | No | — | false) | — | uncategorized | Enable autoloading of tsconfig.json at runtime in standalone executable (default: false) |
| --no-compile-autoload-tsconfig | No | — | — | — | uncategorized | Disable autoloading of tsconfig.json at runtime in standalone executable |
| --compile-autoload-package-json | No | — | false) | — | uncategorized | Enable autoloading of package.json at runtime in standalone executable (default: false) |
| --no-compile-autoload-package-json | No | — | — | — | uncategorized | Disable autoloading of package.json at runtime in standalone executable |
| --compile-executable-path | Yes | val | — | — | uncategorized | Path to a Bun executable to use for cross-compilation instead of downloading |
| --bytecode | No | — | — | — | uncategorized | Use a bytecode cache |
| --watch | No | — | — | — | runtime | Automatically restart the process on file change |
| --no-clear-screen | No | — | — | — | runtime | Disable clearing the terminal screen on reload when --watch is enabled |
| --target | Yes | val | — | — | fileIO, runtime | The intended execution environment for the bundle. "browser", "bun" or "node" |
| --outdir | Yes | val | dist | — | fileIO | Default to "dist" if multiple files |
| --outfile | Yes | val | — | — | fileIO | Write to a file |
| --metafile | Yes | val | — | — | uncategorized | Write a JSON file with metadata about the build |
| --metafile-md | Yes | val | — | — | uncategorized | Write a markdown file with a visualization of the module graph (LLM-friendly) |
| --sourcemap | Yes | val | — | — | fileIO, debug | Build with sourcemaps - 'linked', 'inline', 'external', or 'none' |
| --banner | Yes | val | — | — | uncategorized | Add a banner to the bundled output such as "use client"; for a bundle being used with RSCs |
| --footer | Yes | val | — | — | uncategorized | Add a footer to the bundled output such as // built with bun! |
| --format | Yes | val | esm | — | fileIO, runtime | Specifies the module format to build to. "esm", "cjs" and "iife" are supported. Defaults to "esm", or "cjs" with --bytecode. |
| --root | Yes | val | — | — | uncategorized | Root directory used for multiple entry points |
| --splitting | No | — | — | — | fileIO | Enable code splitting |
| --public-path | Yes | val | — | — | uncategorized | A prefix to be appended to any import paths in bundled code |
| -e, --external | Yes | val | — | — | fileIO | Exclude module from transpilation (can use * wildcards). ex: -e react |
| --allow-unresolved | Yes | val | '*' | — | uncategorized | Allow unresolved dynamic import()/require() specifiers matching these glob patterns. Use '' for opaque specifiers. Default is '*' (allow all). |
| --reject-unresolved | No | — | — | — | uncategorized | Fail the build on any dynamic import()/require() specifier that cannot be resolved at build time. |
| --packages | Yes | val | bundle | — | fileIO, runtime | Add dependencies to bundle or keep them external. "external", "bundle" is supported. Defaults to "bundle". |
| --entry-naming | Yes | val | [dir]/[name] | — | fileIO | Customize entry point filenames. Defaults to "[dir]/[name].[ext]" |
| --chunk-naming | Yes | val | [name]-[hash] | — | fileIO | Customize chunk filenames. Defaults to "[name]-[hash].[ext]" |
| --asset-naming | Yes | val | [name]-[hash] | — | fileIO | Customize asset filenames. Defaults to "[name]-[hash].[ext]" |
| --react-fast-refresh | No | — | — | — | uncategorized | Enable React Fast Refresh transform (does not emit hot-module code, use this for testing) |
| --react-compiler | No | — | — | — | uncategorized | Enable the React Compiler optimizing transform |
| --no-bundle | No | — | — | — | uncategorized | Transpile file only, do not bundle |
| --emit-dce-annotations | No | — | — | — | uncategorized | Re-emit DCE annotations in bundles. Enabled by default unless --minify-whitespace is passed. |
| --minify | No | — | — | — | fileIO | Enable all minification flags |
| --minify-syntax | No | — | — | — | uncategorized | Minify syntax and inline data |
| --minify-whitespace | No | — | — | — | uncategorized | Minify whitespace |
| --minify-identifiers | No | — | — | — | uncategorized | Minify identifiers |
| --keep-names | No | — | — | — | uncategorized | Preserve original function and class names when minifying |
| --css-chunking | No | — | — | — | uncategorized | Chunk CSS files together to reduce duplicated CSS loaded in a browser. Only has an effect when multiple entrypoints import CSS |
| --conditions | Yes | val | — | — | runtime | Pass custom conditions to resolve |
| --app | No | — | — | — | fileIO | (EXPERIMENTAL) Build a web app for production using Bun Bake. |
| --server-components | No | — | — | — | uncategorized | (EXPERIMENTAL) Enable server components |
| --env | Yes | val | 'disable' | — | uncategorized | Inline environment variables into the bundle as process.env.${name}. Defaults to 'disable'. To inline environment variables matching a prefix, use my prefix like 'FOO_PUBLIC_*'. |
| --windows-hide-console | No | — | — | — | uncategorized | When using --compile targeting Windows, prevent a Command prompt from opening alongside the executable |
| --windows-icon | Yes | val | — | — | uncategorized | When using --compile targeting Windows, assign an executable icon |
| --windows-title | Yes | val | — | — | uncategorized | When using --compile targeting Windows, set the executable product name |
| --windows-publisher | Yes | val | — | — | uncategorized | When using --compile targeting Windows, set the executable company name |
| --windows-version | Yes | val | — | — | uncategorized | When using --compile targeting Windows, set the executable version (e.g. 1.2.3.4) |
| --windows-description | Yes | val | — | — | uncategorized | When using --compile targeting Windows, set the executable description |
| --windows-copyright | Yes | val | — | — | uncategorized | When using --compile targeting Windows, set the executable copyright |
| --debug-dump-server-files | No | — | — | — | uncategorized | When --app is set, dump all server files to disk even when building statically |
| --debug-no-minify | No | — | — | — | uncategorized | When --app is set, do not minify anything |