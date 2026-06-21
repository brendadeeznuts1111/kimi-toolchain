# Generic Gate Tree Example

Runnable demo of an L1→L2 gate tree with artifact persistence, lineage, and a
Mermaid execution DAG. This example is the canonical `sourceExample` for the
`kimi-gates` bun-create template.

| Gate             | Level | Description                | Depends on                   |
| ---------------- | ----- | -------------------------- | ---------------------------- |
| `health-check`   | L1    | Process health and memory  | —                            |
| `data-freshness` | L1    | Feed lag and missing ticks | —                            |
| `strategy-check` | L2    | Composite strategy score   | health-check, data-freshness |

## Start

```bash
cd examples/gates
bun install
bun run gate:all
```

Artifacts land in `var/artifacts/<gate>/<timestamp>.json`.

## Commands

```bash
bun run gate:all           # run all gates + save artifacts
bun run gate:graph         # Mermaid execution DAG
bun run gate:status        # artifact summary (JSON)
bun run gate:plan          # dry-run execution plan
bun run src/bin/gate-doctor.ts --gate strategy-check --save-artifact
```

## Project layout

```
src/
├── bin/
│   └── gate-doctor.ts    # CLI runner
├── gates/
│   ├── init.ts           # register all gates
│   ├── registry.ts       # getGate / resolveGateClosure
│   ├── runner.ts         # topological execution + artifact persistence
│   ├── types.ts          # Gate, GateResult, GateLevel
│   ├── health-check.ts   # L1 example gate
│   ├── data-freshness.ts # L1 example gate
│   ├── strategy-check.ts # L2 example gate
│   └── lib/
│       └── artifact-store.ts
└── docs/
    └── extend.md         # how to add gates
```

## Related

- [`templates/bun-create/kimi-gates/`](../templates/bun-create/kimi-gates/) — the bun-create starter this example mirrors
- [`examples/trading-workspace/`](../trading-workspace/) — a concrete 4-gate trading specialization
- [`examples/artifact-trading-loop.md`](../artifact-trading-loop.md) — Alex the quant narrative
- [`examples/control-plane-layers.md`](../control-plane-layers.md) — L0–L3 retention model
- [`examples/artifact-dependency-graphs.md`](../artifact-dependency-graphs.md) — lineage vs execution DAG
