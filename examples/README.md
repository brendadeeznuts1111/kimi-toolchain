# kimi-toolchain Examples Showcase

Runnable projects and narrative guides that demonstrate how the toolchain works end to end. Each entry maps to live dashboard cards in `examples/dashboard` — open the showcase hub at [http://127.0.0.1:5678/](http://127.0.0.1:5678/) or `GET /api/examples`.

**URLs, ports, protocols, and URLPattern routes:** [dashboard-urls.md](dashboard-urls.md) — property tables, `url_protocol` / `url_port` decomposition, and query params (`?canvas=`, `?example=`, `?diff=`).

## Quick start

```bash
# Artifact Portal — one-command convergence demo (no server required)
cd examples/portal && bun run portal:local

# Canonical (Herdr / kimi-dashboard)
cd ~/kimi-toolchain && PORT=5678 bun run dashboard

# Detached daemon (agent-safe; pid at ~/.kimi-code/var/examples-dashboard.pid)
cd ~/kimi-toolchain && bun run dashboard -- --daemon --port=5678

# Direct start (bare index.ts; PORT unset → [dashboard].port or 5678)
cd examples/dashboard && bun run src/index.ts

# Trading artifact loop (L1 → L2 gates with lineage)
cd examples/trading-workspace && bun run trading
```

**Port contract (Dashboard v1.0):** canonical **5678** via `kimi-dashboard` / `HERDR_EXAMPLES_DASHBOARD_URL`. Precedence: `PORT` env → `--port` CLI → `[dashboard].port` in `dx.config.toml` → **5678**. Resolved values: `GET /api/settings`.

## Lanes

### Live Runtime

| Entry                     | Path                 | Cards                                       | Start here                                   |
| ------------------------- | -------------------- | ------------------------------------------- | -------------------------------------------- |
| **Artifact Portal**       | `portal/`            | effect-benchmark, perf-harness, kimi-doctor | `cd examples/portal && bun run portal:local` |
| **Bun API Dashboard**     | `dashboard/`         | gates, kimi-doctor, perf-harness, artifacts | `PORT=5678 bun run dashboard` from repo root |
| **Trading Artifact Loop** | `trading-workspace/` | artifacts, gates, metrics-schema            | `bun run trading`                            |

The dashboard is the primary showcase: **67** live API cards plus `#card-artifacts` identity panel. Canvas filter pills (`?canvas=artifact-lineage`) highlight cards influenced by each IDE companion manifest.

The trading workspace is a self-contained L1+L2 gate tree — data freshness and risk limits feed strategy performance, which feeds model drift. Artifacts land in `var/trading-artifacts/`.

### Runtime guides

| Guide                                  | Focus                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| [dashboard-urls.md](dashboard-urls.md) | URLPattern routes, `PORT` / `[doctor.probe].port` properties, `http:` vs fetch `protocol` |

### Control Plane

| Guide                                                                              | Focus                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [artifact-portal.md](artifact-portal.md)                                           | Canvas → Probe → Herdr → Artifact convergence         |
| [control-plane-layers.md](control-plane-layers.md)                                 | L0–L3 model, retention defaults, readonly serve-probe |
| [artifact-dependency-graphs.md](artifact-dependency-graphs.md)                     | Lineage vs execution DAG                              |
| [dependency-graphs-developer-workflow.md](dependency-graphs-developer-workflow.md) | Daily CLI cheat sheet                                 |
| [artifact-trading-loop.md](artifact-trading-loop.md)                               | Alex the quant — minute-level L1, daily L2            |

### Effect & Perf

| Guide                                            | Focus                                        |
| ------------------------------------------------ | -------------------------------------------- |
| [image-effect.md](image-effect.md)               | First domain effect closed loop              |
| [platform-absorption.md](platform-absorption.md) | Bun improvements → auto-tightened thresholds |

### Agent Workflows

| Guide                                              | Focus                              |
| -------------------------------------------------- | ---------------------------------- |
| [project-health-check.md](project-health-check.md) | Polite first-pass health triage    |
| [what-broke.md](what-broke.md)                     | Failure recovery ladder            |
| [guardian-failure.md](guardian-failure.md)         | Lockfile hash mismatch before push |

## Card mapping

Registry SSOT: `src/lib/examples-showcase.ts`. Lint card ids against `dashboard.html`:

```bash
bun test test/examples-showcase.unit.test.ts
bun run scripts/lint-examples-showcase.ts
```

Deep-link a showcase entry on the dashboard:

```
http://127.0.0.1:5678/?example=portal&canvas=benchmark
http://127.0.0.1:5678/?example=trading-workspace
http://127.0.0.1:5678/?canvas=artifact-lineage&example=artifact-dependency-graphs
http://127.0.0.1:5678/?canvas=artifact-lineage&diff=runA..runB
```

Each showcase entry declares `cardIds` — click **Show N cards** in the dashboard hub to scroll and highlight the linked panels. **Shift+click** two run rows in `#card-artifacts` to set `?diff=`.

## API

| Route                                    | Payload                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `GET /api/settings`                      | Dashboard Contract v1.0 — port, probe, artifact root |
| `GET /api/examples`                      | Lanes, entries, probes, `settings`, `cardIndex`      |
| `GET /api/examples?id=trading-workspace` | Single showcase entry                                |
| `GET /api/examples/trading`              | Trading artifact probe (gate counts)                 |
| `GET /api/cards`                         | Live probe status + `showcaseEntries` per card       |
| `GET /api/canvases`                      | Manifest companions with `influences`                |

Herdr dashboard embeds the examples surface via `HERDR_EXAMPLES_DASHBOARD_URL` (`url_protocol=http:`, `url_port=5678`, `url_pathname=/`). See [dashboard-urls.md](dashboard-urls.md) for the full port/property precedence table.

## Scaffold from examples

| Module             | Source                           | Command                                |
| ------------------ | -------------------------------- | -------------------------------------- |
| `doctor` (default) | `examples/dashboard/src/harness` | `kimi-fix <path>`                      |
| `trading`          | `templates/modules/trading`      | `KIMI_MODULES=trading kimi-fix <path>` |
| `image`            | `templates/modules/image`        | `KIMI_MODULES=image kimi-fix <path>`   |

See [docs/references/template-matrix.md](../docs/references/template-matrix.md) and [dashboard/v53/README.md](dashboard/v53/README.md).
