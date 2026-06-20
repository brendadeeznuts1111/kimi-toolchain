# Artifact Feedback Loop — Trading Domain Example

How the `ArtifactStore` + gate system enables a self-improving monitoring
loop, using a professional trader persona to make it tangible.

Layer model: [control-plane-layers.md](control-plane-layers.md). Lineage:
[artifact-dependency-graphs.md](artifact-dependency-graphs.md).

## Persona: Alex — Independent Quant Trader

Alex runs a trading operation with multiple software systems. He uses
the Kimi artifact system to monitor performance, catch problems early,
and continuously improve his edge.

## Artifact Layout by Business Domain

```bash
.kimi/artifacts/
├── execution-quality/          # Slippage, fill rate, latency
├── strategy-performance/       # P&L, Sharpe, drawdowns
├── risk-limits/                # Position sizing, VaR, margin
├── data-freshness/             # Data lag, missing ticks
├── model-drift/                # Prediction accuracy decay
└── backtest-vs-live/           # Live vs backtest divergence
```

## Gate → Artifact Mapping

| Gate                   | Level | Measures                      | Size     | Frequency          | Business Value        |
| ---------------------- | ----- | ----------------------------- | -------- | ------------------ | --------------------- |
| `data-freshness`       | L1    | Data lag, missing ticks       | 2-5 KB   | Every minute       | Data reliability      |
| `risk-limits`          | L1    | Position sizing, VaR, margin  | 3-7 KB   | Every 5-15 min     | Risk control          |
| `execution-quality`    | L1    | Slippage, fill rate, latency  | 4-8 KB   | Per trade / hourly | Execution edge        |
| `strategy-performance` | L2    | Daily P&L, win rate, drawdown | 6-15 KB  | End of day         | Strategy health       |
| `model-drift`          | L2    | Prediction accuracy decay     | 8-20 KB  | Daily              | Model validity        |
| `backtest-vs-live`     | L2    | Live vs backtest divergence   | 10-30 KB | Daily              | Overfitting detection |

## Feedback Loop

```
Data Collection Agents (frequent)
        ↓
    data-freshness: every minute → artifact
    risk-limits: every 5 minutes → artifact

Analysis Agents (daily / on trigger)
        ↓
    model-drift: reads last 30 days of strategy-performance artifacts
    backtest-vs-live: compares recent vs historical artifacts

Decision / Alert Agents
        ↓
    model-drift degradation → alert + reduce position size
    execution-quality worsening → investigate broker

Improvement Loop
        ↓
    backtest-vs-live artifacts → retrain models → new backtests → loop
```

## Daily Flow

```
08:00  data-freshness gate → artifact
08:05  risk-limits gate     → artifact
09:30  execution-quality    → artifact (post morning session)
17:00  strategy-performance → artifact (end of day)
17:05  backtest-vs-live     → compares today vs backtest
17:10  model-drift          → reads 30 days of performance artifacts
17:15  model-drift issue?   → alert + reduce sizing
```

## Optimization Strategies

| Goal                  | Trader's approach                        | Our equivalent                                                                 |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Prevent storage bloat | Auto-prune >30-90 days per gate          | `ArtifactStore.prune()`                                                        |
| Fast querying         | `?since=` and `?limit=` params           | Artifact list API                                                              |
| Avoid stat() overhead | Store `resultSize` at save time          | `metadata.resultSize`                                                          |
| Detect problems early | Lightweight frequent gates + heavy daily | Card probes + full gates                                                       |
| Agent automation      | Probe server + dashboard                 | `--serve-probe` + Herdr                                                        |
| Audit trail           | Checksum on every artifact               | `ArtifactEnvelope` schema                                                      |
| Session correlation   | Tie artifacts to Kimi/Herdr context      | `metadata.sessionId`, `workspaceId`, `paneId`, `runId` (auto-injected on save) |

## Identity and run correlation (phased model)

Artifacts are temporally grouped by gate name and filename; identity fields add
**who** and **which invocation** produced each envelope. Implementation is
intentionally phased — correlation first, narrative manifests second.

| Phase                                      | Shipped                      | Purpose                                                                                                                 |
| ------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **1 — Identity on every save**             | Yes                          | `runId`, `sessionId`, `workspaceId`, `paneId`, `agentId`, `parentRunId` in `metadata`                                   |
| **2 — Run manifest per doctor invocation** | Yes (with `--save-artifact`) | `.kimi/artifacts/runs/{runId}.json` groups all gates from one closure                                                   |
| **3 — Query + dashboard narrative**        | Yes                          | `fetchDashboardRunsList` / `fetchDashboardRunManifest` on examples dashboard (`handlers/artifacts.ts`) and Herdr server |
| **4 — Canvas deep-link integration**       | Yes                          | `GET /api/canvas-filter?canvas=artifact-lineage&runId=…` → `run-manifest` action; covered by `test/examples-dashboard-canvas-filter.unit.test.ts` |

Gates do not pass identity fields manually. `ArtifactStore.save()` resolves
context from the environment and always stamps a `runId`:

| Field         | Source env                                                            |
| ------------- | --------------------------------------------------------------------- |
| `sessionId`   | `KIMI_CODE_SESSION` or `KIMI_AGENT_SESSION`                           |
| `workspaceId` | `HERDR_WORKSPACE_ID`, `HERDR_SESSION_ID`, or `HERDR_SESSION`          |
| `paneId`      | `HERDR_PANE_ID`                                                       |
| `agentId`     | `KIMI_AGENT_ID` (falls back to `paneId`)                              |
| `runId`       | `KIMI_RUN_ID` during gate-runner closure, else auto-generated `run_*` |
| `parentRunId` | `KIMI_PARENT_RUN_ID` or outer `KIMI_RUN_ID` for nested runs           |

```bash
# Phase 1 — filter artifacts by identity
GET /api/artifacts?sessionId=wd_abc&limit=10
GET /api/artifacts?workspaceId=my-workspace
GET /api/artifacts?runId=run_20260619_120000_ab12cd

# Phase 2 — one doctor invocation, many gates, one manifest
kimi-doctor --gate model-drift --save-artifact
# → shared runId on all closure artifacts + .kimi/artifacts/runs/run_*.json

# Phase 3 — run narrative
GET /api/runs
GET /api/runs/run_20260619_120000_ab12cd

# Phase 4 — reactive canvas deep link
GET /api/canvas-filter?canvas=artifact-lineage&runId=run_20260619_120000_ab12cd
open http://127.0.0.1:5678/?canvas=artifact-lineage&runId=run_20260619_120000_ab12cd
```

Modules: `src/lib/artifact-store.ts`, `src/lib/artifact-identity.ts` (`resolveIdentityContext`),
`src/gates/runner.ts` (`KIMI_RUN_ID`, `saveRunManifest`). Correlates with
`doctor_runs.run_id` in `~/.kimi-code/var/sessions.db`.

## Key Insight

The artifact system isn't just storage — it's the substrate for automated
feedback loops. Each gate writes timestamped snapshots. Other gates read
them. Agents consume them. The system improves without human intervention.

This is the same architecture powering `bunfig-policy`, `perf-gate`,
`card-probe`, and every other gate in the Kimi toolchain.

## Shipped toolchain demo (L2 slice)

Two gates are registered in `src/gates/registry.ts` for agents to exercise the
loop without a full trading stack:

| Gate                   | Level | `dependsOn`            | Reads via `GateContext`                                        |
| ---------------------- | ----- | ---------------------- | -------------------------------------------------------------- |
| `strategy-performance` | L2    | _(none — L1 optional)_ | `getArtifacts("data-freshness")`, `getArtifact("risk-limits")` |
| `model-drift`          | L2    | `strategy-performance` | `getArtifacts("strategy-performance", { since, limit: 30 })`   |

```bash
# Resolve closure + run in topological order (deps first)
kimi-doctor --gate model-drift --save-artifact

# Execution DAG (orchestration — not artifact lineage)
kimi-doctor --gate model-drift --gate-graph

# Declarative + runtime lineage for the newest model-drift artifact
kimi-doctor --artifacts-lineage model-drift --json

# Scaffold a standalone trading loop into a new project
KIMI_MODULES=trading kimi-fix . --profile app
bun run trading:gates
```

Full trading tree (L1 + L2): `templates/modules/trading/` via `KIMI_MODULES=trading`.
See [control-plane-layers.md](control-plane-layers.md) for level semantics.

## References (toolchain)

| Module           | Path                                                            | Role                                                                       |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Artifact storage | `src/lib/artifact-store.ts`                                     | Envelope schema, identity injection, run manifests, prune, lineage Mermaid |
| Identity helper  | `src/lib/artifact-identity.ts`                                  | `resolveIdentityContext`, Herdr pane env exports                           |
| Gate runner      | `src/gates/runner.ts`                                           | `topologicalSort(Gate[])`, parallel levels, `GateContext`                  |
| Gate registry    | `src/gates/registry.ts`                                         | `resolveGateClosure`, built-in gate list                                   |
| Trading gates    | `src/gates/strategy-performance.ts`, `src/gates/model-drift.ts` | L2 demo slice                                                              |
| Lineage graphs   | `src/lib/graph-to-mermaid.ts`                                   | Execution DAG + artifact lineage export                                    |
| Probe server     | `src/lib/card-probe-server.ts`                                  | HTTP observation for dashboard cards                                       |
| Doctor CLI       | `src/bin/kimi-doctor.ts`                                        | `--gate`, `--gate-graph`, `--artifacts-lineage`                            |
