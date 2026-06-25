# Bun CLI Completion Matrix

Generated from "completions/bun-cli.json" (sha256: `5a2cd016`).

## Command surface

| Command  | Aliases | Flags | Value flags | Defaults | Choices | Positional args | Req pos | Opt pos | File I/O |  PM | Runtime | Debug | Network | Subcommands | Dynamic source           |
| -------- | ------: | ----: | ----------: | -------: | ------: | --------------: | ------: | ------: | -------: | --: | ------: | ----: | ------: | ----------: | ------------------------ |
| run      |       — |    82 |          42 |        7 |       3 |               2 |       1 |       1 |        5 |   0 |      16 |     5 |       1 |           0 | scripts, files, binaries |
| test     |       — |    28 |          16 |        7 |       0 |               2 |       0 |       2 |        0 |   0 |       2 |     0 |       1 |           0 | files                    |
| x        |       — |     5 |           0 |        0 |       0 |               3 |       1 |       2 |        0 |   0 |       1 |     2 |       0 |           0 | —                        |
| repl     |       — |    82 |          42 |        7 |       3 |               2 |       1 |       1 |        5 |   0 |      16 |     5 |       1 |           0 | —                        |
| exec     |       — |     0 |           0 |        0 |       0 |               1 |       1 |       0 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| install  |       i |    41 |          15 |        1 |       0 |               1 |       0 |       1 |        2 |  25 |       1 |     5 |       6 |           0 | —                        |
| add      |       a |    40 |          14 |        1 |       0 |               1 |       0 |       1 |        2 |  25 |       0 |     5 |       6 |           0 | packages                 |
| remove   |      rm |    34 |          14 |        1 |       0 |               1 |       0 |       1 |        2 |  20 |       0 |     5 |       6 |           0 | packages                 |
| update   |       — |    38 |          15 |        1 |       0 |               1 |       0 |       1 |        2 |  20 |       1 |     5 |       6 |           0 | —                        |
| audit    |       — |     3 |           2 |        0 |       0 |               1 |       0 |       1 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| outdated |       — |    36 |          15 |        1 |       0 |               2 |       0 |       2 |        2 |  20 |       1 |     5 |       6 |           0 | —                        |
| link     |       — |    34 |          14 |        1 |       0 |               1 |       0 |       1 |        2 |  20 |       0 |     5 |       6 |           0 | —                        |
| unlink   |       — |    34 |          14 |        1 |       0 |               1 |       0 |       1 |        2 |  20 |       0 |     5 |       6 |           0 | —                        |
| publish  |       — |    40 |          19 |        4 |       0 |               2 |       0 |       2 |        2 |  20 |       0 |     5 |       6 |           0 | —                        |
| patch    |       — |    36 |          15 |        1 |       0 |               1 |       0 |       1 |        2 |  20 |       0 |     5 |       6 |           0 | —                        |
| pm       |       — |     0 |           0 |        0 |       0 |               2 |       0 |       2 |        0 |   0 |       0 |     0 |       0 |          21 | —                        |
| info     |       — |    35 |          14 |        1 |       0 |               2 |       0 |       2 |        2 |  20 |       0 |     5 |       6 |           0 | —                        |
| why      |       — |     0 |           0 |        0 |       0 |               3 |       1 |       2 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| build    |       — |    57 |          27 |       12 |       0 |               0 |       0 |       0 |       12 |   1 |       2 |     1 |       0 |           0 | files                    |
| init     |       — |     6 |           0 |        0 |       0 |               2 |       0 |       2 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| create   |       c |     0 |           0 |        0 |       0 |               0 |       0 |       0 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| upgrade  |       — |     0 |           0 |        0 |       0 |               1 |       0 |       1 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |
| feedback |       — |     0 |           0 |        0 |       0 |               0 |       0 |       0 |        0 |   0 |       0 |     0 |       0 |           0 | —                        |

## Global flag inheritance by command

| Command  | Inherits global | Own flags | Total surface | Critical inherited                               |
| -------- | --------------: | --------: | ------------: | ------------------------------------------------ |
| run      |              84 |        82 |           166 | --watch, --hot, --env-file, --preload, --inspect |
| test     |              84 |        28 |           112 | --watch, --hot, --env-file, --preload, --inspect |
| x        |              84 |         5 |            89 | --watch, --hot, --env-file, --preload, --inspect |
| repl     |              84 |        82 |           166 | --watch, --hot, --env-file, --preload, --inspect |
| exec     |              84 |         0 |            84 | --watch, --hot, --env-file, --preload, --inspect |
| install  |              84 |        41 |           125 | --watch, --hot, --env-file, --preload, --inspect |
| add      |              84 |        40 |           124 | --watch, --hot, --env-file, --preload, --inspect |
| remove   |              84 |        34 |           118 | --watch, --hot, --env-file, --preload, --inspect |
| update   |              84 |        38 |           122 | --watch, --hot, --env-file, --preload, --inspect |
| audit    |              84 |         3 |            87 | --watch, --hot, --env-file, --preload, --inspect |
| outdated |              84 |        36 |           120 | --watch, --hot, --env-file, --preload, --inspect |
| link     |              84 |        34 |           118 | --watch, --hot, --env-file, --preload, --inspect |
| unlink   |              84 |        34 |           118 | --watch, --hot, --env-file, --preload, --inspect |
| publish  |              84 |        40 |           124 | --watch, --hot, --env-file, --preload, --inspect |
| patch    |              84 |        36 |           120 | --watch, --hot, --env-file, --preload, --inspect |
| pm       |               0 |         0 |             0 | — (pm is isolated)                               |
| info     |              84 |        35 |           119 | --watch, --hot, --env-file, --preload, --inspect |
| why      |              84 |         0 |            84 | --watch, --hot, --env-file, --preload, --inspect |
| build    |              84 |        57 |           141 | --watch, --hot, --env-file, --preload, --inspect |
| init     |              84 |         6 |            90 | --watch, --hot, --env-file, --preload, --inspect |
| create   |              84 |         0 |            84 | --watch, --hot, --env-file, --preload, --inspect |
| upgrade  |              84 |         0 |            84 | --watch, --hot, --env-file, --preload, --inspect |
| feedback |              84 |         0 |            84 | --watch, --hot, --env-file, --preload, --inspect |

## Dynamic completion sources

| Source             | Provider         | Args | Commands         |
| ------------------ | ---------------- | ---- | ---------------- |
| scripts            | bun getcompletes | s    | run              |
| binaries           | bun getcompletes | b    | run              |
| files              | bun getcompletes | j    | run, test, build |
| installed packages | bun getcompletes | a    | remove           |
| registry packages  | —                | —    | add              |

## Global flags

Total: 84

| Flag                       | Short | Has value | Description                                                                                                                                         |
| -------------------------- | ----- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| --silent                   | —     | no        | Don't print the script command                                                                                                                      |
| --elide-lines              | —     | yes       | Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines.                                               |
| --version                  | -v    | no        | Print version and exit                                                                                                                              |
| --revision                 | —     | no        | Print version with revision and exit                                                                                                                |
| --filter                   | -F    | yes       | Run a script in all workspace packages matching the pattern                                                                                         |
| --bun                      | -b    | no        | Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)                                                             |
| --no-orphans               | —     | no        | Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only.                                                          |
| --shell                    | —     | yes       | Control the shell used for package.json scripts. Supports either 'bun' or 'system'                                                                  |
| --workspaces               | —     | no        | Run a script in all workspace packages (from the "workspaces" field in package.json)                                                                |
| --parallel                 | —     | no        | Run multiple scripts concurrently with Foreman-style output                                                                                         |
| --sequential               | —     | no        | Run multiple scripts sequentially with Foreman-style output                                                                                         |
| --no-exit-on-error         | —     | no        | Continue running other scripts when one fails (with --parallel/--sequential)                                                                        |
| --watch                    | —     | no        | Automatically restart the process on file change                                                                                                    |
| --hot                      | —     | no        | Enable auto reload in the Bun runtime, test runner, or bundler                                                                                      |
| --no-clear-screen          | —     | no        | Disable clearing the terminal screen on reload when --hot or --watch is enabled                                                                     |
| --smol                     | —     | no        | Use less memory, but run garbage collection more often                                                                                              |
| --preload                  | -r    | yes       | Import a module before other modules are loaded                                                                                                     |
| --require                  | —     | yes       | Alias of --preload, for Node.js compatibility                                                                                                       |
| --import                   | —     | yes       | Alias of --preload, for Node.js compatibility                                                                                                       |
| --inspect                  | —     | yes       | Activate Bun's debugger                                                                                                                             |
| --inspect-wait             | —     | yes       | Activate Bun's debugger, wait for a connection before executing                                                                                     |
| --inspect-brk              | —     | yes       | Activate Bun's debugger, set breakpoint on first line of code and wait                                                                              |
| --cpu-prof                 | —     | no        | Start CPU profiler and write profile to disk on exit                                                                                                |
| --cpu-prof-name            | —     | yes       | Specify the name of the CPU profile file                                                                                                            |
| --cpu-prof-dir             | —     | yes       | Specify the directory where the CPU profile will be saved                                                                                           |
| --cpu-prof-md              | —     | no        | Output CPU profile in markdown format (grep-friendly, designed for LLM analysis)                                                                    |
| --cpu-prof-interval        | —     | yes       | Specify the sampling interval in microseconds for CPU profiling (default: 1000)                                                                     |
| --heap-prof                | —     | no        | Generate V8 heap snapshot on exit (.heapsnapshot)                                                                                                   |
| --heap-prof-name           | —     | yes       | Specify the name of the heap profile file                                                                                                           |
| --heap-prof-dir            | —     | yes       | Specify the directory where the heap profile will be saved                                                                                          |
| --heap-prof-md             | —     | no        | Generate markdown heap profile on exit (for CLI analysis)                                                                                           |
| --if-present               | —     | no        | Exit without an error if the entrypoint does not exist                                                                                              |
| --no-install               | —     | no        | Disable auto install in the Bun runtime                                                                                                             |
| --install                  | —     | yes       | Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always). |
| --i                        | -i    | no        | Auto-install dependencies during execution. Equivalent to --install=fallback.                                                                       |
| --eval                     | -e    | yes       | Evaluate argument as a script                                                                                                                       |
| --print                    | -p    | yes       | Evaluate argument as a script and print the result                                                                                                  |
| --prefer-offline           | —     | no        | Skip staleness checks for packages in the Bun runtime and resolve from disk                                                                         |
| --prefer-latest            | —     | no        | Use the latest matching versions of packages in the Bun runtime, always checking npm                                                                |
| --port                     | —     | yes       | Set the default port for Bun.serve                                                                                                                  |
| --conditions               | —     | yes       | Pass custom conditions to resolve                                                                                                                   |
| --fetch-preconnect         | —     | yes       | Preconnect to a URL while code is loading                                                                                                           |
| --experimental-http2-fetch | —     | no        | Offer h2 in fetch() TLS ALPN. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1                                                                  |
| --experimental-http3-fetch | —     | no        | Honor Alt-Svc: h3 in fetch() and upgrade to HTTP/3. Same as BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1                                            |
| --max-http-header-size     | —     | yes       | Set the maximum size of HTTP headers in bytes. Default is 16KiB                                                                                     |
| --dns-result-order         | —     | yes       | Set the default order of DNS lookup results. Valid orders: verbatim (default), ipv4first, ipv6first                                                 |
| --experimental-stream-iter | —     | no        | Enable the experimental stream/iter API (node:stream/iter, node:zlib/iter).                                                                         |
| --expose-gc                | —     | no        | Expose gc() on the global object. Has no effect on Bun.gc().                                                                                        |
| --no-deprecation           | —     | no        | Suppress all reporting of the custom deprecation.                                                                                                   |
| --throw-deprecation        | —     | no        | Determine whether or not deprecation warnings result in errors.                                                                                     |
| --title                    | —     | yes       | Set the process title                                                                                                                               |
| --zero-fill-buffers        | —     | no        | Boolean to force Buffer.allocUnsafe(size) to be zero-filled.                                                                                        |
| --use-system-ca            | —     | no        | Use the system's trusted certificate authorities                                                                                                    |
| --use-openssl-ca           | —     | no        | Use OpenSSL's default CA store                                                                                                                      |
| --use-bundled-ca           | —     | no        | Use bundled CA store                                                                                                                                |
| --redis-preconnect         | —     | no        | Preconnect to $REDIS_URL at startup                                                                                                                 |
| --sql-preconnect           | —     | no        | Preconnect to PostgreSQL at startup                                                                                                                 |
| --no-addons                | —     | no        | Throw an error if process.dlopen is called, and disable export condition "node-addons"                                                              |
| --unhandled-rejections     | —     | yes       | One of "strict", "throw", "warn", "none", or "warn-with-error-code"                                                                                 |
| --console-depth            | —     | yes       | Set the default depth for console.log object inspection (default: 2)                                                                                |
| --user-agent               | —     | yes       | Set the default User-Agent header for HTTP requests                                                                                                 |
| --cron-title               | —     | yes       | Title for cron execution mode                                                                                                                       |
| --cron-period              | —     | yes       | Cron period for cron execution mode                                                                                                                 |
| --main-fields              | —     | yes       | Main fields to lookup in package.json. Defaults to --target dependent                                                                               |
| --preserve-symlinks        | —     | no        | Preserve symlinks when resolving files                                                                                                              |
| --preserve-symlinks-main   | —     | no        | Preserve symlinks when resolving the main entry point                                                                                               |
| --extension-order          | —     | yes       | Defaults to: .tsx,.ts,.jsx,.js,.json                                                                                                                |
| --tsconfig-override        | —     | yes       | Specify custom tsconfig.json. Default $cwd/tsconfig.json                                                                                            |
| --define                   | -d    | yes       | Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.                                          |
| --drop                     | —     | yes       | Remove function calls, e.g. --drop=console removes all console.\* calls.                                                                            |
| --feature                  | —     | yes       | Enable a feature flag for dead-code elimination, e.g. --feature=SUPER_SECRET                                                                        |
| --loader                   | -l    | yes       | Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi                            |
| --no-macros                | —     | no        | Disable macros from being executed in the bundler, transpiler and runtime                                                                           |
| --jsx-factory              | —     | yes       | Changes the function called when compiling JSX elements using the classic JSX runtime                                                               |
| --jsx-fragment             | —     | yes       | Changes the function called when compiling JSX fragments                                                                                            |
| --jsx-import-source        | —     | yes       | Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"                                         |
| --jsx-runtime              | —     | yes       | "automatic" (default) or "classic"                                                                                                                  |
| --jsx-side-effects         | —     | no        | Treat JSX elements as having side effects (disable pure annotations)                                                                                |
| --ignore-dce-annotations   | —     | no        | Ignore tree-shaking annotations such as @**PURE**                                                                                                   |
| --env-file                 | —     | yes       | Load environment variables from the specified file(s)                                                                                               |
| --no-env-file              | —     | no        | Disable automatic loading of .env files                                                                                                             |
| --cwd                      | —     | yes       | Absolute path to resolve files & entry points from. This just changes the process' cwd.                                                             |
| --config                   | -c    | yes       | Specify path to Bun config file. Default $cwd/bunfig.toml                                                                                           |
| --help                     | -h    | no        | Display this menu and exit                                                                                                                          |
