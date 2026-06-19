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

| Goal                  | Trader's approach                        | Our equivalent            |
| --------------------- | ---------------------------------------- | ------------------------- |
| Prevent storage bloat | Auto-prune >30-90 days per gate          | `ArtifactStore.prune()`   |
| Fast querying         | `?since=` and `?limit=` params           | Artifact list API         |
| Avoid stat() overhead | Store `resultSize` at save time          | `metadata.resultSize`     |
| Detect problems early | Lightweight frequent gates + heavy daily | Card probes + full gates  |
| Agent automation      | Probe server + dashboard                 | `--serve-probe` + Herdr   |
| Audit trail           | Checksum on every artifact               | `ArtifactEnvelope` schema |

## Key Insight

The artifact system isn't just storage — it's the substrate for automated
feedback loops. Each gate writes timestamped snapshots. Other gates read
them. Agents consume them. The system improves without human intervention.

This is the same architecture powering `bunfig-policy`, `perf-gate`,
`card-probe`, and every other gate in the Kimi toolchain.
