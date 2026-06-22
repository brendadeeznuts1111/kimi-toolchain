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
tail -f ~/.kimi-code/var/examples-dashboard-events.jsonl  # structured HTTP audit (route, status, probe)
tail -f ~/.kimi-code/var/examples-dashboard.log           # daemon stdout only (startup lines)

# Legacy direct (defaults to 5678 — Dashboard Contract v1.0)
cd examples/dashboard && bun run src/index.ts
# url_protocol=http: url_hostname=127.0.0.1 url_port=5678 url_pathname=/
```

**Ports:** canonical **5678** (`kimi-dashboard`, Herdr, bare `index.ts`). Precedence: `PORT` env → `--port` CLI → `[dashboard].port` in `dx.config.toml` → `5678`. Resolved values: `GET /api/settings`. Debug: `?orphans=true` highlights canvas-unlinked cards.

## API Routes

<!-- dashboard-route-inventory:AUTO -->

**Endpoint count:** **136** routes on the examples dashboard (`examples/dashboard/src/index.ts` + `handlers/artifacts.ts`).

- **3** page/health routes (`/`, `/health`, `/api/health`)
- **113** static dispatch API paths (`handlers/routes.ts`, shell assets + `/dashboard-loaders/*.js` lazy lanes)
- **4** index.serve routes (`index.ts` `routes` cookie mutations + `/api/ws` fetch probe)
- **16** artifact/run routes (`handlers/artifacts.ts` + URLPattern; not duplicated in route table)
<!-- /dashboard-route-inventory:AUTO -->

Routing order: `handleArtifactsRequest()` (URLPattern) → `dispatchDashboardRoute()` (`handlers/routes.ts` + `handlers/dispatch.ts`) → `404`. Handler implementations are SSOT in `src/handlers/*.ts` (shared helpers in `handlers/shared.ts`). Non-`GET`/`HEAD` on `/api/artifacts`, `/api/runs`, `/api/sessions` namespaces → **405** JSON.

**Shell assets:** `src/dashboard.html` (panels + showcase hub), `src/dashboard.css`, `src/dashboard.js` — served at `/`, `/dashboard.css`, `/dashboard.js`. Card route discovery scans `dashboard.js` for `fetchJson`/`card()` probes (`src/lib/dashboard-card-registry.ts`).

Full URL inventory: [dashboard-urls.md](../dashboard-urls.md). Pattern SSOT: `src/lib/dashboard-route-patterns.ts`.

### Core & contract

| Method       | Path            | Query                                                                     | Response shape                                                                                                                                                                                                          |
| ------------ | --------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`        | `/`             | `?example=` `?canvas=` `?runId=` `?diff=` `?lineageGate=` identity params | `text/html` — `dashboard.html`                                                                                                                                                                                          |
| `GET`        | `/health`       | —                                                                         | `text/plain` — `ok` (card-probe auto-discovery)                                                                                                                                                                         |
| `GET` `HEAD` | `/api/health`   | —                                                                         | `ok` with `cache-control: no-store`; other methods → **405**                                                                                                                                                            |
| `GET`        | `/api/settings` | —                                                                         | `{ schemaVersion, port, dashboardUrl, probeHost, probePort, artifactRoot, defaultCanvas, retentionMs, identityFieldMaxLen, cardCount, canvasLinkedCount, canvasOrphanCount, canonicalPort, legacyDirectPort, sources }` |

### Showcase, cards & canvases

| Method | Path                    | Query                                                                                       | Response shape                                                                                             |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/examples`         | `id` — single showcase entry                                                                | `{ schemaVersion, lanes, entries[], projects, guides, cardIndex, settings, fetchedAt }`                    |
| `GET`  | `/api/examples/trading` | —                                                                                           | `{ ok, schemaVersion, project, gateCounts, …probeTradingWorkspace }`                                       |
| `GET`  | `/api/cards`            | `canvas` — manifest filter; `orphans=true` — unlinked only; `probe=false` — hub probes only | `{ ok, cards[{ id, title, apiRoute, influencedBy, status, showcaseEntries? }], total, filter, fetchedAt }` |
| `GET`  | `/api/canvases`         | —                                                                                           | Manifest companion rows with `influences` card ids                                                         |
| `GET`  | `/api/canvas-filter`    | `canvas` `runId` `sessionId` `workspaceId` `paneId` `agentId` `diff=left..right`            | `{ ok, params, action?, fetchedAt }` — deep-link filter actions                                            |

### Artifacts, runs & gates (URLPattern)

Identity filters on list endpoints: `sessionId`, `workspaceId`, `paneId`, `agentId`, `runId`, `session` (maps to `workspaceId`), `since`, `until`, `limit`.

| Method | Path                             | Query                                              | Response shape                                                                                                        |
| ------ | -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/artifacts`                 | identity filters; `includeLineage=1`               | `{ ok, projectPath, artifacts[{ gate, count, latestPath, status, summary, lineageSource?, … }], filter?, fetchedAt }` |
| `GET`  | `/api/artifacts/list`            | `gate` (default `bunfig-policy`); identity filters | `{ ok, gate, files[], entries[], filter }`                                                                            |
| `GET`  | `/api/artifacts/filter-options`  | —                                                  | `{ ok, filterOptions }` — distinct identity fields                                                                    |
| `GET`  | `/api/artifacts/metadata`        | `gate`; identity filters                           | `{ ok, rows[], projectPath, filter, fetchedAt }`                                                                      |
| `GET`  | `/api/artifacts/context`         | —                                                  | `{ ok, projectPath, probeHealth, nodes[], edges[], fetchedAt }`                                                       |
| `GET`  | `/api/artifacts/index/stats`     | —                                                  | `{ ok, projectPath, stats, synced, fetchedAt }`                                                                       |
| `GET`  | `/api/artifacts/feed.xml`        | `limit` (default 50, max 200)                      | `application/rss+xml`                                                                                                 |
| `GET`  | `/api/artifacts/:gate/lineage`   | `path` — relative artifact path                    | `{ ok, gate, path, graph, mermaid?, lineageSource, fetchedAt }`                                                       |
| `GET`  | `/api/artifacts/:gate/diff`      | `a` `b` — relative paths (**required**)            | `{ ok, gate, pathA, pathB, same, hashA, hashB, … }`                                                                   |
| `GET`  | `/api/runs`                      | identity filters                                   | `{ ok, projectPath, runs[{ runId, status, gates, … }], fetchedAt }`                                                   |
| `GET`  | `/api/runs/:runId`               | —                                                  | `{ ok, runId, manifest, artifacts[{ gate, path, status, metadata… }], fetchedAt }`                                    |
| `GET`  | `/api/sessions`                  | —                                                  | `{ ok, projectPath, sessions: { kimi, herdr }, fetchedAt }`                                                           |
| `GET`  | `/api/sessions/:scope/runs`      | —                                                  | Same shape as `/api/runs` filtered by session scope                                                                   |
| `GET`  | `/api/sessions/:scope/artifacts` | —                                                  | Same shape as `/api/artifacts` filtered by session scope                                                              |
| `GET`  | `/api/gates/graph`               | `gate` — optional closure root                     | `{ ok, gate?, mermaid, gates[], fetchedAt }`                                                                          |

### kimi-doctor & toolchain

| Method | Path                    | Query | Response shape                                                                  |
| ------ | ----------------------- | ----- | ------------------------------------------------------------------------------- |
| `GET`  | `/api/bundle`           | —     | `kimi-doctor --bundle --json` output                                            |
| `GET`  | `/api/compile`          | —     | `kimi-doctor --compile-check --json` output                                     |
| `GET`  | `/api/gates`            | —     | `kimi-doctor --effect-gates --json` output                                      |
| `GET`  | `/api/kimi-doctor`      | —     | Doctor automation summary + gate snapshot                                       |
| `GET`  | `/api/kimi-publish`     | —     | Publish workflow demo payload                                                   |
| `GET`  | `/api/toolchain/health` | —     | `{ ok, total, found, missing[], shadowed[], all[] }`                            |
| `GET`  | `/api/toolchain/heal`   | —     | `{ action, missing[], command, note }` — read-only install hint                 |
| `GET`  | `/api/env`              | —     | `{ path[], tools[], keyVars, dashboardUrl, listenPort, probePort, portSource }` |
| `GET`  | `/api/deps`             | —     | `{ binDir, totalPackages, tree, bunx }`                                         |
| `GET`  | `/api/secrets`          | —     | `{ available, methods, note }` — Bun.secrets probe                              |
| `GET`  | `/api/scaffold`         | —     | Bootstrap paths, `TEMPLATE_POLICY_CHECK_IDS`, skills catalog, perf scripts    |
| `GET`  | `/api/file-split`       | —     | `{ sections[{ name, content }], note }` — handler split demo                    |

### Perf harness

| Method | Path                       | Query | Response shape                                                                                  |
| ------ | -------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `GET`  | `/api/perf-harness`        | —     | `{ metrics[{ name, actualMs, thresholdMs, pass }], allPass, summary }` — legacy inline bench    |
| `GET`  | `/api/perf-registry`       | —     | `{ metrics[{ name, symbol, actualMs, thresholdMs, pass }], allPass, registrySize, failures[] }` |
| `GET`  | `/api/perf-train`          | —     | `{ metrics, train }` — writes `thresholds.json` when all pass                                   |
| `GET`  | `/api/perf-report`         | —     | `text/html` — `generatePerfHTML()` report                                                       |
| `GET`  | `/api/perf-auto-discover`  | —     | Auto-discovered module benchmarks                                                               |
| `GET`  | `/api/threshold-overrides` | —     | Active threshold override layers                                                                |
| `GET`  | `/api/perf-threaded`       | —     | Worker-thread perf comparison                                                                   |
| `GET`  | `/api/effect-benchmark`    | —     | Symbol-keyed effect benchmark suite                                                             |

### URL, email-i18n & node:url probes

| Method | Path            | Query | Response shape                                                                                                                                                                                             |
| ------ | --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/url`      | —     | `{ properties, searchParams, staticMethods, relativeResolution, i18n{ ok, domains[], labels[], urls[], gate }, emailI18n{ ok, summary, emails[], limitations[] }, note }` — gates `url-i18n`, `email-i18n` |
| `GET`  | `/api/url-node` | —     | `{ idn[], fileRoundtrip, format, urlToHttpOptions, note }` — `node:url` compat                                                                                                                             |

### Bun runtime & inspect

| Method | Path                    | Response summary                               |
| ------ | ----------------------- | ---------------------------------------------- |
| `GET`  | `/api/bunfig`           | Parsed `bunfig.toml` sections                  |
| `GET`  | `/api/build-info`       | `[define]` compile-time metadata + runtime     |
| `GET`  | `/api/runtime-info`     | `Bun.main`, `Bun.which`, active bunfig path    |
| `GET`  | `/api/build-compile`    | `bun build --compile` demo                     |
| `GET`  | `/api/dotenv`           | `.env` load order and precedence               |
| `GET`  | `/api/console`          | Custom `Console({ inspectOptions })`           |
| `GET`  | `/api/console-depth`    | `bunfig.toml` `console.depth` demo             |
| `GET`  | `/api/inspect`          | `Bun.inspect()` typed sample (`text/plain`)    |
| `GET`  | `/api/inspect-simple`   | `text/plain` — inspect options table + samples |
| `GET`  | `/api/inspect-config`   | Environment-based inspect presets              |
| `GET`  | `/api/inspect-table`    | `Bun.inspect.table()` demos                    |
| `GET`  | `/api/inspect-defaults` | `BunInspectOptions` defaults                   |
| `GET`  | `/api/string-utils`     | `Bun.stringWidth`, `Bun.escapeHTML`            |
| `GET`  | `/api/uuid`             | `Bun.randomUUIDv7()` encodings                 |
| `GET`  | `/api/markdown/html`    | `Bun.markdown.html()`                          |
| `GET`  | `/api/markdown/ansi`    | `Bun.markdown.ansi()`                          |
| `GET`  | `/api/semver`           | `Bun.semver.order` / `satisfies`               |
| `GET`  | `/api/deep-equals`      | `Bun.deepEquals()` edge cases                  |
| `GET`  | `/api/deep-match`       | `Bun.deepMatch()` patterns                     |
| `GET`  | `/api/nanoseconds`      | `Bun.nanoseconds()` timing                     |
| `GET`  | `/api/sleep`            | `Bun.sleep()` elapsed demo                     |
| `GET`  | `/api/color`            | `Bun.color()` conversions                      |
| `GET`  | `/api/peek`             | `Bun.peek()` promise status                    |
| `GET`  | `/api/strip-ansi`       | ANSI strip utilities                           |
| `GET`  | `/api/random-bytes`     | `Bun.randomBytes()`                            |

### I/O, crypto, shell & process

| Method | Path                | Response summary                         |
| ------ | ------------------- | ---------------------------------------- |
| `GET`  | `/api/file-io`      | `Bun.write` + `Bun.file`                 |
| `GET`  | `/api/write-smart`  | Smart write helper                       |
| `GET`  | `/api/stream-hash`  | Streaming hash                           |
| `GET`  | `/api/glob`         | `Bun.Glob` scan results                  |
| `GET`  | `/api/glob-orphan`  | Orphan glob lint                         |
| `GET`  | `/api/sqlite`       | In-memory `bun:sqlite`                   |
| `GET`  | `/api/password`     | `Bun.password` hash/verify               |
| `GET`  | `/api/crypto-hash`  | `Bun.CryptoHasher`                       |
| `GET`  | `/api/image`        | `Bun.Image` metadata                     |
| `GET`  | `/api/effect-image` | Transpiler scan + effect image benchmark |
| `GET`  | `/api/shell`        | Bun shell demo                           |
| `GET`  | `/api/exec`         | `Bun.spawn` exec                         |
| `GET`  | `/api/spawn-sync`   | Sync spawn                               |
| `GET`  | `/api/ipc`          | IPC channel demo                         |
| `GET`  | `/api/ipc-matrix`   | IPC capability matrix                    |
| `GET`  | `/api/cron`         | `Bun.cron` scheduler                     |
| `GET`  | `/api/os`           | `node:os` info                           |
| `GET`  | `/api/node-http`    | `node:http` server demo                  |
| `GET`  | `/api/http2`        | HTTP/2 h2c client/server                 |
| `GET`  | `/api/set-headers`  | Response header helpers                  |
| `GET`  | `/api/util-types`   | `node:util/types` `is*` checks           |
| `GET`  | `/api/tty`          | TTY detection                            |
| `GET`  | `/api/terminal`     | `Bun.Terminal` PTY                       |

### Isolation, transpiler & symbols

| Method | Path                   | Response summary                                                            |
| ------ | ---------------------- | --------------------------------------------------------------------------- |
| `GET`  | `/api/vm-context`      | Isolation factory + `vm.Context` roundtrip                                  |
| `GET`  | `/api/shadow-realm`    | `ShadowRealm` eval                                                          |
| `GET`  | `/api/transpiler`      | `Bun.Transpiler` transform                                                  |
| `GET`  | `/api/transpiler-scan` | Export scan                                                                 |
| `GET`  | `/api/extract-methods` | Method extraction                                                           |
| `GET`  | `/api/symbols`         | Symbol registry                                                             |
| `GET`  | `/api/global-store`    | Global store effect                                                         |
| `GET`  | `/api/metrics-schema`  | Metrics schema validation                                                   |
| `GET`  | `/api/trace-verify`    | Trace verification                                                          |
| `GET`  | `/api/bun-test`        | `bun test` demo + `--changed` import-graph mechanics (`changedImportGraph`) |

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
