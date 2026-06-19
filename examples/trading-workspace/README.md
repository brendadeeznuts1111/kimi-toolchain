# Trading Artifact Loop

Self-contained demo of the L1 → L2 control-plane feedback loop from [artifact-trading-loop.md](../artifact-trading-loop.md). Persona: **Alex**, an independent quant who runs frequent tactical gates and daily strategic analysis.

## Gate tree

```
data-freshness (L1) ─┐
risk-limits (L1)     ─┼→ strategy-performance (L2) → model-drift (L2)
```

| Gate                   | Level | Cadence                    | Measures                     |
| ---------------------- | ----- | -------------------------- | ---------------------------- |
| `data-freshness`       | L1    | Every minute               | Data lag, missing ticks      |
| `risk-limits`          | L1    | Every 5–15 min             | Position sizing, VaR, margin |
| `strategy-performance` | L2    | End of day                 | P&L, Sharpe, drawdown        |
| `model-drift`          | L2    | After strategy-performance | Prediction accuracy decay    |

## Start

```bash
cd examples/trading-workspace

# Run full gate closure + save artifacts
bun run trading

# Mermaid execution DAG
bun run trading:graph

# Single gate with lineage
bun run trading:drift

# Artifact summary (no gate run)
bun run trading:status
```

## Artifacts

Saved under `var/trading-artifacts/<gate>/<timestamp>.json`. Each envelope includes payload status and optional `dependsOn` lineage metadata.

```bash
# List from repo root (toolchain ArtifactStore)
kimi-doctor --artifacts-list strategy-performance
kimi-doctor --artifacts-latest model-drift
kimi-doctor --artifacts-lineage model-drift --json
```

## Dashboard cards

Open the examples dashboard and use the showcase hub (**Trading Artifact Loop** → **Show cards**):

| Card                  | What it shows                                             |
| --------------------- | --------------------------------------------------------- |
| `card-artifacts`      | Identity filters (session, workspace, pane, agent, runId) |
| `card-gates`          | Effect discipline and gate health                         |
| `card-metrics-schema` | Threshold and metrics contract                            |

```bash
cd ../dashboard && bun run src/index.ts
# http://localhost:5678 — showcase hub at top
```

## Scaffold into a new project

```bash
KIMI_MODULES=trading kimi-fix my-trading-app
# Copies templates/modules/trading → src/trading + trading-doctor CLI
```

## Related docs

- [control-plane-layers.md](../control-plane-layers.md) — L0–L3 retention model
- [artifact-dependency-graphs.md](../artifact-dependency-graphs.md) — lineage vs execution order
- [dependency-graphs-developer-workflow.md](../dependency-graphs-developer-workflow.md) — daily CLI workflow
