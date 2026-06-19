# kimi-toolchain Dashboard

Demo of Bun-native APIs and kimi-toolchain features in one page. The **Examples Showcase** hub at the top maps every `examples/` project and guide to live cards — registry at `src/lib/examples-showcase.ts`, index at [examples/README.md](../README.md).

**URL patterns, port properties, and protocol:** [dashboard-urls.md](../dashboard-urls.md).

## Start

```bash
# Canonical (from repo root)
cd ~/kimi-toolchain && PORT=5678 bun run dashboard

# Detached — survives agent/harness exit (pid + log under ~/.kimi-code/var/)
cd ~/kimi-toolchain && bun run dashboard -- --daemon --port=5678
kill "$(cat ~/.kimi-code/var/examples-dashboard.pid)"   # stop

# Legacy direct (defaults to 5678 — Dashboard Contract v1.0)
cd examples/dashboard && bun run src/index.ts
# url_protocol=http: url_hostname=127.0.0.1 url_port=5678 url_pathname=/
```

**Ports:** canonical **5678** (`kimi-dashboard`, Herdr, bare `index.ts`). Precedence: `PORT` env → `--port` CLI → `[dashboard].port` in `dx.config.toml` → `5678`. Resolved values: `GET /api/settings`. Debug: `?orphans=true` highlights canvas-unlinked cards.

## API Routes

| Route                          | Feature                       | Backend                                                                                          |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `/api/bundle`                  | Bundle analysis               | `kimi-doctor --bundle --json`                                                                    |
| `/api/compile`                 | Compile check                 | `kimi-doctor --compile-check --json`                                                             |
| `/api/gates`                   | Gate health                   | `kimi-doctor --effect-gates --json`                                                              |
| `/api/inspect-table`           | Pretty-print table            | `Bun.inspect.table()` / column filter / colors                                                   |
| `/api/bunfig`                  | bunfig.toml inspection        | `Bun.TOML.parse()`                                                                               |
| `/api/markdown/html`           | Markdown → HTML               | `Bun.markdown.html()`                                                                            |
| `/api/markdown/ansi`           | Markdown → ANSI text          | `Bun.markdown.ansi()`                                                                            |
| `/api/semver`                  | Version comparison            | `Bun.semver.order()` / `satisfies()`                                                             |
| `/api/deep-equals`             | Structural equality           | `Bun.deepEquals()`                                                                               |
| `/api/nanoseconds`             | Monotonic timer               | `Bun.nanoseconds()`                                                                              |
| `/api/sleep`                   | Non-blocking sleep            | `Bun.sleep()`                                                                                    |
| `/api/console`                 | Custom Console inspect        | `new Console({ inspectOptions })`                                                                |
| `/api/tty`                     | TTY & terminal detection      | `process.stdout.isTTY`, dimensions, TERM                                                         |
| `/api/terminal`                | PTY & termios flags           | `new Bun.Terminal()`, `setRawMode()`                                                             |
| `/api/color`                   | ANSI color conversion         | `Bun.color()`                                                                                    |
| `/api/peek`                    | Promise inspection            | `Bun.peek()` / `Bun.peek.status()`                                                               |
| `/api/http2`                   | HTTP/2 h2c demo               | `node:http2.createServer()` + `connect()`                                                        |
| `/api/url`                     | URL parsing & search params   | `URL`, `URL.canParse()`, `URL.parse()`, `URLSearchParams`                                        |
| `/api/url-node`                | node:url compat               | `domainToASCII`, `domainToUnicode`, `fileURLToPath`, `format`, `urlToHttpOptions`                |
| `/api/password`                | Password hashing              | `Bun.password.hash()` / `verify()`                                                               |
| `/api/crypto-hash`             | Crypto hashing                | `Bun.CryptoHasher` SHA-256/SHA-512                                                               |
| `/api/sqlite`                  | In-memory SQL                 | `bun:sqlite` Database, query, prepared statements                                                |
| `/api/file-io`                 | File read/write               | `Bun.write()` + `Bun.file()`                                                                     |
| `/api/glob`                    | File globbing                 | `Bun.Glob` pattern scanning                                                                      |
| `/api/util-types`              | Node type checks              | `node:util/types` 18 is\* functions                                                              |
| `/api/dotenv`                  | .env auto-loading             | `.env` file loading order, precedence                                                            |
| `/api/settings`                | Dashboard Contract SSOT       | `port`, `probePort`, `artifactRoot`, `cardCount` (67)                                            |
| `/api/examples`                | Examples showcase registry    | `?id=` filter; probes + `settings` + `cardIndex`                                                 |
| `/api/examples/trading`        | Trading artifact probe        | Gate counts from `var/trading-artifacts/`                                                        |
| `/api/cards`                   | Card probe aggregation        | 67 cards; `?canvas=` manifest filter; `?probe=false`; `showcaseEntries`                          |
| `/api/artifacts/:gate/diff`    | Artifact path diff            | `?a=` `?b=` relative paths                                                                       |
| `/api/canvases`                | Manifest companions           | IDE canvas rows with `influences` card ids                                                       |
| `/api/artifacts/:gate/lineage` | Artifact lineage (URLPattern) | `DASHBOARD_ARTIFACT_LINEAGE` in `dashboard-route-patterns.ts`                                    |
| `/health`                      | Liveness                      | Plain `ok` — used by port auto-discovery (`card-probe.ts`)                                       |
| `/`                            | Dashboard UI                  | Query: `?example=` `?canvas=` `?runId=` `?diff=` (see [dashboard-urls.md](../dashboard-urls.md)) |

### Artifact lineage & diff (`#card-artifacts`)

Deep links and UI share the same query contract:

```
http://127.0.0.1:5678/?canvas=artifact-lineage&lineageGate=model-drift
http://127.0.0.1:5678/?canvas=artifact-lineage&diff=runA..runB
http://127.0.0.1:5678/?lineageGate=model-drift&diff=.kimi/artifacts/.../a.json..b.json
```

| Interaction                   | Effect                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| Click gate row                | Select gate → lineage explorer (execution DAG vs artifact lineage) |
| Click run row                 | Filter by `runId` + expand run detail                              |
| **Shift+click** two run rows  | Set `?diff=runA..runB` → run manifest comparison                   |
| **Shift+click** two gate rows | Set `?diff=pathA..pathB` → `GET /api/artifacts/:gate/diff`         |

Canvas filter changes dispatch `canvas-filter-applied`; the artifacts card re-hydrates identity params and scrolls into view when `canvas=artifact-lineage`.

## What's demonstrated

| Feature               | Demo vehicle                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Bundle analysis       | Largest modules table, node_modules bloat warnings                                                                        |
| Inspect table         | `Bun.inspect.table()` — full table, column-filtered, plain-text side-by-side                                              |
| Compile check         | ESM+bytecode badge, cpu-prof-md, heap-prof-md, gate status                                                                |
| Gate health           | Effect discipline pass/fail, violation list                                                                               |
| Markdown rendering    | Live `Bun.markdown.html()` output in-browser                                                                              |
| TOML parsing          | `Bun.TOML.parse()` → structured JSON                                                                                      |
| Semver                | order() comparison table + satisfies() range checks                                                                       |
| Deep equals           | TypedArrays, Dates, NaN, nested objects                                                                                   |
| Nanoseconds           | High-res timing of 1K Math.sqrt() calls                                                                                   |
| Sleep                 | Non-blocking 10ms sleep with actual elapsed time                                                                          |
| Custom Console        | `new Console({ inspectOptions })` — depth=4, expanded, sorted vs default                                                  |
| TTY Detection         | `process.stdout.isTTY`, dimensions, TERM, COLORTERM, NO_COLOR, FORCE_COLOR                                                |
| Bun.Terminal          | PTY creation, termios flags (control/input/local/output), raw mode toggle, command I/O                                    |
| Bun.color             | 8 conversions: hex/name → ansi-16 / ansi-256 / ansi-16m with color swatches                                               |
| Bun.peek              | Promise status peeking: pending (sync status check) vs fulfilled (value extraction)                                       |
| node:http2            | h2c server + client: origins whitelist, remoteCustomSettings, ALPN, stream request/response                               |
| URL / URLSearchParams | Full URL parsing (11 properties), searchParams (get/getAll/has/size/toString), static canParse/parse, relative resolution |
| .env loading          | Auto-loading order: .env → .env.{NODE_ENV} → .env.local, precedence demo, `[env]` bunfig option                           |
| node:url              | domainToASCII/domainToUnicode (IDN/Punycode), fileURLToPath roundtrip, url.format, urlToHttpOptions                       |
| Bun.password          | argon2id hash/verify, constant-time comparison, timing measurement                                                        |
| Bun.CryptoHasher      | Incremental SHA-256 (multi-update), SHA-512 one-shot, bytes output                                                        |
| bun:sqlite            | In-memory SQLite: CREATE, INSERT (prepared), SELECT queries, row count                                                    |
| Bun.write / file      | Atomic write + lazy file handle: .text(), .size, .type, .exists()                                                         |
| Bun.Glob              | Pattern scanning: _.ts, \*\*/_.html, \*.{json,toml} with brace expansion                                                  |
| node:util/types       | 18 of 43 is\* checks: buffers, typed arrays, errors, promises, maps, sets, primitives                                     |
| Isolation factory     | `KIMI_ISOLATION=worker\|realm\|messageport` — probe-aware backends in `src/lib/isolation/`                                |
| Perf harness          | `src/harness/` — `thresholds.json` loop via `bun run perf` / `bun run perf:train`                                         |

## Isolation factory

Three backends behind one `IsolationEffect` interface (`kimi.effect.isolation`):

| Mode              | Backend                                   | When                                               |
| ----------------- | ----------------------------------------- | -------------------------------------------------- |
| `realm` (default) | `ShadowRealm`                             | Same-thread script eval                            |
| `worker`          | `worker_threads` Worker                   | Separate thread, full isolation                    |
| `messageport`     | `vm.Context` + `moveMessagePortToContext` | Same-thread with structured port I/O (probe-gated) |

```bash
KIMI_ISOLATION=worker bun run src/index.ts
# /api/vm-context — factory diagnostics + roundtrip latency
# /api/perf-registry — isolation.createChannel / isolation.roundtrip workloads
```

Tests: `cd examples/dashboard && bun test` (messageport cases exercise fallback when probe fails).

## Performance harness

Self-calibrating control loop (`src/harness/`):

1. **Defaults** — `DEFAULT_THRESHOLDS` in `module-registry.ts`
2. **`bun run perf:train`** — writes `thresholds.json` (actualMs × 1.1) when all pass
3. **Subsequent runs** — `loadThresholds()` merges layers: defaults → trained → `[doctor.thresholds]` in bunfig → `overrideThresholds()` API

```bash
cd examples/dashboard
bun run perf              # --perf-gates + HTML report
bun run perf:train        # update thresholds.json in project root
bun run perf:watch        # fs.watch src/harness + src/lib/isolation → re-benchmark
# API: /api/perf-registry, /api/perf-report, /api/perf-train
```

CLI: `src/bin/perf-doctor.ts` — `--perf-gates`, `--report`, `--train`, `--watch`.

**HTTP protocol benchmarks** (`http.fetch-h1` / `h2` / `h3`): local echo servers + `fetch({ protocol })`. H2/H3 skip gracefully when the runtime lacks client or QUIC serve support.

**Watch split:** `perf-doctor --watch` uses `node:fs.watch` (file-triggered). Main `kimi-doctor --watch` polls effect-gates every 5s (not perf).

## Scaffold with bun create

```bash
cp -r ~/kimi-toolchain/templates/bun-create/kimi-toolchain ~/.bun-create/
bun create kimi-toolchain my-app
```
