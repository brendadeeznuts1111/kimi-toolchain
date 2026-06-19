# Examples Dashboard — URLs, Ports, Protocols & Properties

How the examples showcase wires **base URLs**, **URLPattern** routes, **TOML/env properties**, and **HTTP protocol** layers. Decomposition style matches `dx:table extract … -u --exact` (`url_protocol`, `url_hostname`, `url_port`, `url_pathname`, `url_search`).

Related: [dashboard/README.md](dashboard/README.md), [serve-probe.md](../docs/references/serve-probe.md), [schemas/endpoints.schema.toml](../schemas/endpoints.schema.toml).

## Three URL layers

| Layer               | Mechanism                                                           | Example                                     |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| **Browser base**    | `Bun.serve({ port })` where `port = Number(Bun.env.PORT) \|\| 5678` | `http://127.0.0.1:5678/`                    |
| **Dynamic routes**  | Module-scoped `URLPattern` in `src/lib/dashboard-route-patterns.ts` | `/api/artifacts/:gate/lineage`              |
| **Cross-dashboard** | Explicit env base URL or port auto-discovery                        | `EXAMPLES_DASHBOARD_URL` → `GET /api/cards` |

Static card routes in `examples/dashboard/src/index.ts` use a `switch (url.pathname)`; artifact, run, and session trees use URLPattern matchers shared with Herdr and serve-probe.

### Browser base (`Bun.serve` + dashboard port chain)

The examples dashboard uses `resolveDashboardStartupPort()` — **not** `[doctor.probe].port`:

```ts
// examples/dashboard/src/index.ts
const { port: listenPort } = await resolveDashboardStartupPort(projectRoot, {
  cliPort: parseDashboardCliPort(Bun.argv),
});

const server = Bun.serve({
  port: listenPort,
  async fetch(req) {
    const artifactResponse = await handleArtifactsRequest(req); // URLPattern first
    // …switch (url.pathname) for static /api/* card routes
  },
});
```

| Precedence | Source                     | Default |
| ---------- | -------------------------- | ------- |
| 1          | `PORT` env                 | —       |
| 2          | `--port` / `-p` CLI        | —       |
| 3          | `[dashboard].port` in TOML | —       |
| 4          | Hardcoded fallback         | `5678`  |

Full base URL env (`EXAMPLES_DASHBOARD_URL`) is for **clients** (Herdr iframe, `card-probe.ts`) — it does not change what port `Bun.serve` listens on.

## Port properties

Ports are **properties** with **separate precedence chains** per surface. Integer range **1–65535** when set explicitly (same contract as `schemas/endpoints.schema.toml` `url_port`).

### serve-probe bind (`kimi-doctor --serve-probe`)

Resolver: `resolveProbeServerBind()` in `src/lib/doctor-probe-config.ts`.

| Precedence | Source                                    | Default                              |
| ---------- | ----------------------------------------- | ------------------------------------ |
| 1          | `PROBE_SERVER_PORT` env                   | —                                    |
| 2          | `[doctor.probe].port` in `dx.config.toml` | scaffold `5678`                      |
| 3          | Hardcoded fallback                        | `5678` (`DEFAULT_PROBE_SERVER_PORT`) |

Host: `PROBE_SERVER_HOST` env → `[doctor.probe].host` → `127.0.0.1`.

### Cross-dashboard discovery (client-side)

When no explicit base URL env is set, `src/lib/card-probe.ts` probes loopback ports:

| Surface            | Ports tried            | Health `url_pathname` |
| ------------------ | ---------------------- | --------------------- |
| Examples           | `3000`, `5678`, `8080` | `/health`             |
| Herdr orchestrator | `18412`                | `/api/health`         |

`EXAMPLES_DASHBOARD_URL` / `HERDR_DASHBOARD_URL` **skip** port scanning when set.

### Herdr panes — no `HERDR_PANE_PORT`

**`HERDR_PANE_PORT` is not a toolchain env var.** Herdr panes are identified by `HERDR_PANE_ID` and talk to the Herdr daemon over a **unix socket** (`HERDR_SOCKET`, `ws+unix://…`), not an HTTP listen port per pane.

| Concept                | Env / mechanism                          | HTTP port?                           |
| ---------------------- | ---------------------------------------- | ------------------------------------ |
| Pane identity          | `HERDR_PANE_ID`                          | No — socket IPC                      |
| Orchestrator dashboard | `HERDR_DASHBOARD_URL` (default `:18412`) | Yes — one shared server              |
| Examples tab iframe    | `HERDR_EXAMPLES_DASHBOARD_URL`           | Yes — points at examples `Bun.serve` |
| SSH remote host        | `HERDR_SSH_PORT` (orchestrator remote)   | SSH, not pane HTTP                   |

### Surface table

| Property / env                 | Default                | Protocol | Pathname (health) | Role                                      |
| ------------------------------ | ---------------------- | -------- | ----------------- | ----------------------------------------- |
| `PORT`                         | `5678`                 | `http:`  | `/health`         | Examples dashboard (`examples/dashboard`) |
| `[dashboard].port`             | `5678` (scaffold)      | `http:`  | `/health`         | TOML fallback when `PORT` / CLI unset     |
| `[doctor.probe].port`          | `5678` (scaffold)      | `http:`  | `/api/health`     | `kimi-doctor --serve-probe` card cache    |
| `PROBE_SERVER_PORT`            | `5678` (no TOML)       | `http:`  | `/api/health`     | Overrides TOML port when set              |
| `HERDR_DASHBOARD_URL`          | port `18412`           | `http:`  | `/api/health`     | Herdr orchestrator dashboard              |
| `HERDR_EXAMPLES_DASHBOARD_URL` | port `5678`            | `http:`  | `/health`         | Herdr **Examples** tab iframe base        |
| Auto-discovery                 | `3000`, `5678`, `8080` | `http:`  | `/health`         | `src/lib/card-probe.ts` examples scan     |
| Auto-discovery                 | `18412`                | `http:`  | `/api/health`     | Herdr scan                                |

Parser: `readDoctorProbeConfig()` in `src/lib/doctor-probe-config.ts`. Scaffold sample:

```toml
[dashboard]
port = 5678

[doctor.probe]
port = 5678
interval = 15000
host = "127.0.0.1"
```

Env overrides (see `templates/scaffold/env.example`):

```bash
PORT=5678
EXAMPLES_DASHBOARD_URL=http://127.0.0.1:5678
HERDR_DASHBOARD_URL=http://127.0.0.1:18412
HERDR_EXAMPLES_DASHBOARD_URL=http://127.0.0.1:5678/
PROBE_SERVER_HOST=127.0.0.1
PROBE_SERVER_PORT=5678
```

## Protocol

Two different “protocol” concepts — do not conflate them.

### Serve transport (dashboard listen URL)

| Surface            | Typical `url_protocol` | `url_hostname`             | Notes                                                          |
| ------------------ | ---------------------- | -------------------------- | -------------------------------------------------------------- |
| Examples dashboard | `http:`                | `127.0.0.1` or `localhost` | `Bun.serve`; TLS optional in Herdr via `http3` / cert paths    |
| serve-probe        | `http:`                | `127.0.0.1`                | Read-only artifact + card cache                                |
| Herdr dashboard    | `http:`                | `127.0.0.1`                | May upgrade to HTTPS/H3 per `herdr-dashboard-server` transport |

### Fetch benchmark protocol (perf harness)

Pinned per request via `fetch(url, { protocol })` — not the listen URL of the dashboard.

| Registry key    | `protocol` value | Card                 | Skip when                            |
| --------------- | ---------------- | -------------------- | ------------------------------------ |
| `http.fetch-h1` | `http1.1`        | `card-perf-registry` | —                                    |
| `http.fetch-h2` | `http2`          | `card-perf-registry` | Client or TLS echo unavailable       |
| `http.fetch-h3` | `http3`          | `card-perf-registry` | QUIC / `Bun.serve` http3 unavailable |

Implementation: `examples/dashboard/src/harness/http-bench.ts`, handlers in `kimi-doctor.ts` / `perf-registry.ts`.

## URLPattern routes (dynamic pathname)

SSOT: `src/lib/dashboard-route-patterns.ts`. Patterns are **module singletons** — compiled once at load, then reused on every request (`pattern.test()` / `pattern.exec()`). `pathnameGroup(match, key)` decodes `%2F` captures.

### Performance (pre-compiled patterns)

Bun’s `URLPattern` engine was optimized in the 1.3.x line (~**2.3× faster** `test`/`exec` vs earlier builds; see [Bun v1.3.12 blog](https://bun.com/blog/bun-v1.3.12)). This repo exports patterns as top-level constants so the hot path in `handleArtifactsRequest` and serve-probe does not allocate new `URLPattern` instances per request — important when `/api/cards?probe=true` fans out dozens of parallel GETs.

```bash
bun test test/dashboard-route-patterns.unit.test.ts
```

| Pattern constant                 | Pathname pattern                 | Capture groups | Methods                     |
| -------------------------------- | -------------------------------- | -------------- | --------------------------- |
| `DASHBOARD_RUN_MANIFEST`         | `/api/runs/:runId`               | `runId`        | `GET`                       |
| `DASHBOARD_SESSION_RUNS`         | `/api/sessions/:scope/runs`      | `scope`        | `GET`                       |
| `DASHBOARD_SESSION_ARTIFACTS`    | `/api/sessions/:scope/artifacts` | `scope`        | `GET`                       |
| `DASHBOARD_ARTIFACT_INDEX_STATS` | `/api/artifacts/index/stats`     | —              | `GET`                       |
| `DASHBOARD_ARTIFACT_LINEAGE`     | `/api/artifacts/:gate/lineage`   | `gate`         | `GET`                       |
| `DASHBOARD_ARTIFACT_DIFF`        | `/api/artifacts/:gate/diff`      | `gate`         | `GET` (+ `?a=` `?b=`)       |
| `PROBE_ARTIFACTS_ROOT`           | `/api/artifacts`                 | —              | `GET`                       |
| `PROBE_ARTIFACTS_GATE`           | `/api/artifacts/:gate`           | `gate`         | `GET`                       |
| `PROBE_ARTIFACTS_LATEST`         | `/api/artifacts/:gate/latest`    | `gate`         | `GET`                       |
| `PROBE_ARTIFACTS_REFRESH`        | `/api/artifacts/:gate/refresh`   | `gate`         | `POST` → **403** (ADR-0004) |

`isDashboardArtifactNamespace(pathname)` returns true for `/api/artifacts`, `/api/runs`, `/api/sessions`, and subpaths — non-`GET`/`HEAD` mutating calls receive **405** on the examples dashboard.

## Static showcase & card routes

Examples dashboard (`index.ts`) — selected high-traffic paths:

| `url_pathname`          | Query properties                                                             | Payload                                                         |
| ----------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/api/examples`         | `id` — filter single showcase entry                                          | `buildExamplesShowcasePayload()`                                |
| `/api/examples/trading` | —                                                                            | Trading artifact probe                                          |
| `/api/cards`            | `canvas` — manifest filter; `probe=false` — skip deep GET                    | Card registry + `showcaseEntries`                               |
| `/api/canvases`         | —                                                                            | Manifest companions + `influences`                              |
| `/api/artifacts`        | `sessionId`, `workspaceId`, `paneId`, `agentId`, `runId`, `includeLineage=1` | Identity-filtered artifact list                                 |
| `/api/settings`         | —                                                                            | Dashboard Contract v1.0 SSOT (`port`, `probePort`, `cardCount`) |
| `/api/runs`             | identity query params (same as artifacts)                                    | Run manifest list                                               |
| `/api/gates/graph`      | `gate` — optional closure root                                               | Execution DAG metadata + Mermaid                                |
| `/health`               | —                                                                            | `ok` (text)                                                     |

## Browser query properties (dashboard UI)

These are **search** properties on the page URL (`url_search`), not server routes.

| Param         | Property               | Example                                    | Effect                                                               |
| ------------- | ---------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `canvas`      | manifest or `canvasId` | `?canvas=artifact-lineage`                 | Filter/highlight cards; fires `canvas-filter-applied`                |
| `example`     | showcase entry `id`    | `?example=trading-workspace`               | Showcase hub scroll + card highlight (canvas ∩ example intersection) |
| `diff`        | `left..right`          | `?diff=runA..runB` or `?diff=pathA..pathB` | Run manifest diff or artifact path diff (`#card-artifacts-diff`)     |
| `lineageGate` | gate name              | `?lineageGate=model-drift`                 | Selected gate for lineage explorer + path diffs                      |
| `sessionId`   | identity               | `?sessionId=…`                             | Artifact/run identity filter (synced to URL)                         |
| `workspaceId` | identity               | `?workspaceId=…`                           | Artifact/run identity filter                                         |
| `paneId`      | identity               | `?paneId=…`                                | Artifact/run identity filter                                         |
| `agentId`     | identity               | `?agentId=…`                               | Artifact/run identity filter                                         |
| `runId`       | identity               | `?runId=…`                                 | Artifact/run identity filter + run detail panel                      |
| `probe`       | boolean string         | `?probe=false` on `/api/cards`             | Skip parallel route probes                                           |

**Diff picker (UI):** shift+click two run rows in `#card-artifacts` sets `?diff=runA..runB`; shift+click two gate rows (with saved paths) sets `?diff=pathA..pathB` (requires `lineageGate` or selected gate).

Resolved listen/probe ports and `dashboardUrl` come from `GET /api/settings` (Dashboard Contract v1.0) — not hardcoded in the PATH header.

Full deep-link decomposition:

```
http://127.0.0.1:5678/?example=trading-workspace&canvas=artifact-lineage&diff=runA..runB
│      │           │    │                              │
│      │           │    url_search                      │
│      │           url_port (default 80 omitted; canonical 5678 via kimi-dashboard)
│      url_hostname
url_protocol
url_pathname = /
```

## Decomposed endpoint inventory (examples stack)

| name                      | url                                                       | url_protocol | url_hostname | url_port | url_pathname                         | url_search         |
| ------------------------- | --------------------------------------------------------- | ------------ | ------------ | -------- | ------------------------------------ | ------------------ |
| examples-dashboard        | `http://127.0.0.1:5678/`                                  | `http:`      | `127.0.0.1`  | `5678`   | `/`                                  | —                  |
| examples-health           | `http://127.0.0.1:5678/health`                            | `http:`      | `127.0.0.1`  | `5678`   | `/health`                            | —                  |
| examples-showcase         | `http://127.0.0.1:5678/api/examples`                      | `http:`      | `127.0.0.1`  | `5678`   | `/api/examples`                      | `id=<entry>`       |
| examples-cards            | `http://127.0.0.1:5678/api/cards`                         | `http:`      | `127.0.0.1`  | `5678`   | `/api/cards`                         | `canvas=` `probe=` |
| examples-artifact-lineage | `http://127.0.0.1:5678/api/artifacts/model-drift/lineage` | `http:`      | `127.0.0.1`  | `5678`   | `/api/artifacts/model-drift/lineage` | —                  |
| serve-probe-cards         | `http://127.0.0.1:5678/api/cards`                         | `http:`      | `127.0.0.1`  | `5678`   | `/api/cards`                         | —                  |
| herdr-meta                | `http://127.0.0.1:18412/api/meta`                         | `http:`      | `127.0.0.1`  | `18412`  | `/api/meta`                          | —                  |
| herdr-examples-health     | `http://127.0.0.1:18412/api/examples/health`              | `http:`      | `127.0.0.1`  | `18412`  | `/api/examples/health`               | —                  |

### Schema validation (`endpoints.schema.toml`)

Root `dx.config.toml` defines `[[endpoints]]` rows mirroring the inventory table above. Validate with:

```bash
# Unit gate (prepare + validate, same pipeline as dx:table)
bun test test/table-schema.unit.test.ts

# CLI — toolchain endpoints
bun run dx:table extract dx.config.toml endpoints \
  -u --exact --schema schemas/endpoints.schema.toml --format table

# Fixture regression (strict pathname contract)
bun run dx:table extract test/fixtures/dx-url-endpoints.toml endpoints \
  -u --exact --schema schemas/endpoints.schema.toml --format table
```

Column rules: [schemas/README.md](../schemas/README.md) · [schemas/endpoints.schema.toml](../schemas/endpoints.schema.toml).

## Quick commands

```bash
# Examples dashboard (PORT unset → [dashboard].port or 5678)
cd examples/dashboard && bun run src/index.ts

# Canonical detached daemon (survives harness exit)
cd ~/kimi-toolchain && bun run dashboard -- --daemon --port=5678

# Override port property
PORT=8080 bun run src/index.ts

# serve-probe with TOML port
kimi-doctor --serve-probe   # reads [doctor.probe].port

# Card discovery without env
bun run doctor --probe-cards   # scans 5678, 3000, 8080

# URLPattern unit tests
bun test test/dashboard-route-patterns.unit.test.ts
```
