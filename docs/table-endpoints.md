# endpoints

Source tables: `dx.config.toml`, `examples/dashboard/src/index.ts`, `examples/dashboard/src/handlers/artifacts.ts`.

## Toolchain (`dx.config.toml`)

| name           | url                                                                                          | SourceFile     |
| :------------- | :------------------------------------------------------------------------------------------- | :------------- |
| cloudflare-mcp | https://mcp.cloudflare.com/mcp                                                               | dx.config.toml |
| herdr-skill    | https://github.com/ogulcancelik/herdr/blob/d998753efe506a04c80306795efc72bff60bb0ec/SKILL.md | dx.config.toml |

## Examples dashboard (`examples/dashboard`)

**Count:** 101 routes (3 page/health + 86 static `switch` + 12 URLPattern artifact/run). Canonical port **5678**. SSOT: [examples/dashboard/README.md](../examples/dashboard/README.md).

### Page & contract

| name                 | method   | path            | query                                                    | response summary                                   | SourceFile            |
| :------------------- | :------- | :-------------- | :------------------------------------------------------- | :------------------------------------------------- | :-------------------- |
| dashboard-ui         | GET      | `/`             | `example` `canvas` `runId` `diff` `lineageGate` identity | `text/html` dashboard                              | index.ts              |
| dashboard-health     | GET      | `/health`       | —                                                        | `ok` — card-probe discovery                        | index.ts              |
| dashboard-api-health | GET HEAD | `/api/health`   | —                                                        | `ok` + `cache-control: no-store`                   | index.ts              |
| dashboard-settings   | GET      | `/api/settings` | —                                                        | `{ schemaVersion, port, probePort, cardCount, … }` | dashboard-settings.ts |

### Showcase & cards

| name               | method | path                    | query                      | response summary                     | SourceFile           |
| :----------------- | :----- | :---------------------- | :------------------------- | :----------------------------------- | :------------------- |
| examples-showcase  | GET    | `/api/examples`         | `id`                       | Showcase lanes + entries + cardIndex | examples-showcase.ts |
| examples-trading   | GET    | `/api/examples/trading` | —                          | Trading workspace gate probe         | examples-showcase.ts |
| dashboard-cards    | GET    | `/api/cards`            | `canvas` `orphans` `probe` | 67 cards + route probes              | canvas-cards.ts      |
| dashboard-canvases | GET    | `/api/canvases`         | —                          | Manifest companions                  | canvas-cards.ts      |
| canvas-filter      | GET    | `/api/canvas-filter`    | `canvas` `diff` identity   | Deep-link filter actions             | canvas-cards.ts      |

### Artifacts & runs (URLPattern)

| name                 | method | path                             | query                       | response summary            | SourceFile   |
| :------------------- | :----- | :------------------------------- | :-------------------------- | :-------------------------- | :----------- |
| artifacts-list       | GET    | `/api/artifacts`                 | identity `includeLineage=1` | Per-gate artifact summary   | artifacts.ts |
| artifacts-files      | GET    | `/api/artifacts/list`            | `gate` identity             | File entries for one gate   | artifacts.ts |
| artifacts-filter-opt | GET    | `/api/artifacts/filter-options`  | —                           | Distinct identity fields    | artifacts.ts |
| artifacts-metadata   | GET    | `/api/artifacts/metadata`        | `gate` identity             | Metadata rows               | artifacts.ts |
| artifacts-context    | GET    | `/api/artifacts/context`         | —                           | Probe + graph context       | artifacts.ts |
| artifacts-index      | GET    | `/api/artifacts/index/stats`     | —                           | Index stats                 | artifacts.ts |
| artifacts-feed       | GET    | `/api/artifacts/feed.xml`        | `limit`                     | RSS XML                     | artifacts.ts |
| artifact-lineage     | GET    | `/api/artifacts/:gate/lineage`   | `path`                      | Lineage graph               | artifacts.ts |
| artifact-diff        | GET    | `/api/artifacts/:gate/diff`      | `a` `b`                     | Hash diff                   | artifacts.ts |
| runs-list            | GET    | `/api/runs`                      | identity                    | Run manifest list           | artifacts.ts |
| run-manifest         | GET    | `/api/runs/:runId`               | —                           | Run + per-gate artifacts    | artifacts.ts |
| gates-graph          | GET    | `/api/gates/graph`               | `gate`                      | Execution DAG Mermaid       | artifacts.ts |
| sessions-index       | GET    | `/api/sessions`                  | —                           | Session scope index         | artifacts.ts |
| session-runs         | GET    | `/api/sessions/:scope/runs`      | —                           | Runs filtered by scope      | artifacts.ts |
| session-artifacts    | GET    | `/api/sessions/:scope/artifacts` | —                           | Artifacts filtered by scope | artifacts.ts |

### URL / email-i18n & perf

| name             | method | path                       | query | response summary                               | SourceFile                        |
| :--------------- | :----- | :------------------------- | :---- | :--------------------------------------------- | :-------------------------------- |
| url-probe        | GET    | `/api/url`                 | —     | URL + `i18n` (`url-i18n`) + `emailI18n` probes | index.ts / url-urlsearchparams.ts |
| url-node         | GET    | `/api/url-node`            | —     | `node:url` IDN + file URL roundtrip            | index.ts                          |
| perf-harness     | GET    | `/api/perf-harness`        | —     | Legacy inline timings                          | perf-registry.ts                  |
| perf-registry    | GET    | `/api/perf-registry`       | —     | MODULE_REGISTRY benchmarks                     | perf-registry.ts                  |
| perf-train       | GET    | `/api/perf-train`          | —     | Train thresholds.json                          | perf-registry.ts                  |
| perf-report      | GET    | `/api/perf-report`         | —     | HTML report                                    | perf-registry.ts                  |
| perf-auto        | GET    | `/api/perf-auto-discover`  | —     | Auto-discovered benches                        | perf-auto-discover.ts             |
| perf-threaded    | GET    | `/api/perf-threaded`       | —     | Worker-thread comparison                       | perf-threaded.ts                  |
| effect-benchmark | GET    | `/api/effect-benchmark`    | —     | Symbol effect suite                            | effect-benchmark.ts               |
| threshold-ovr    | GET    | `/api/threshold-overrides` | —     | Threshold override layers                      | threshold-overrides.ts            |

### Static card APIs (`index.ts` switch)

All `GET`. See [examples/dashboard-urls.md](../examples/dashboard-urls.md) for the full 86-path matrix. Highlights:

| name     | path                 | backend                         |
| :------- | :------------------- | :------------------------------ |
| bundle   | `/api/bundle`        | `kimi-doctor --bundle --json`   |
| compile  | `/api/compile`       | `kimi-doctor --compile-check`   |
| gates    | `/api/gates`         | `kimi-doctor --effect-gates`    |
| kimi-doc | `/api/kimi-doctor`   | Doctor automation snapshot      |
| env      | `/api/env`           | PATH + toolchain bin resolution |
| bunfig   | `/api/bunfig`        | `Bun.TOML.parse`                |
| inspect  | `/api/inspect-table` | `Bun.inspect.table`             |
| vm-ctx   | `/api/vm-context`    | Isolation factory diagnostics   |

## Herdr orchestrator extras (port 18412)

Session routes above are shared with the examples dashboard. Herdr adds orchestrator-only routes (`/api/meta`, `/api/agents/live`, `/api/probe/cards`, …) — see [dashboard-urls.md](../examples/dashboard-urls.md).

## serve-probe only (`kimi-doctor --serve-probe`)

| name          | method | path                           | notes                        |
| :------------ | :----- | :----------------------------- | :--------------------------- |
| probe-gate    | GET    | `/api/artifacts/:gate`         | Single gate artifact         |
| probe-latest  | GET    | `/api/artifacts/:gate/latest`  | Latest envelope              |
| probe-refresh | POST   | `/api/artifacts/:gate/refresh` | **403** read-only (ADR-0004) |
