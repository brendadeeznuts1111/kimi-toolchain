# {{name}}

L1→L2 gate tree with artifact persistence and lineage. Scaffolded from [kimi-toolchain](https://github.com/brendadeeznuts1111/kimi-toolchain).

Optimized for Bun v1.3.13+:

- Isolated linker (`--linker=isolated`) for ~8× faster installs in peer-heavy workspaces
- Test runner: `--isolate`, `--parallel`, `--shard`, `--changed` for CI and large suites
- mimalloc v3: ~5% lower baseline memory (health-check gate reflects this)

@see https://bun.com/blog/bun-v1.3.13

## Quickstart

```bash
bun install
bun run gate:all
```

## Gate tree

```
health-check (L1)    ─┐
data-freshness (L1)  ─┼→ strategy-check (L2)
```

| Gate             | Level | Description                | Depends on                   |
| ---------------- | ----- | -------------------------- | ---------------------------- |
| `health-check`   | L1    | Process health and memory  | —                            |
| `data-freshness` | L1    | Feed lag and missing ticks | —                            |
| `strategy-check` | L2    | Composite strategy score   | health-check, data-freshness |

## Commands

```bash
# Run all gates + save artifacts
bun run gate:all

# Mermaid execution DAG
bun run gate:graph

# Single gate with lineage
bun run src/bin/gate-doctor.ts --gate strategy-check --save-artifact

# Artifact summary (no gate run)
bun run gate:status

# Dry-run execution plan
bun run gate:plan

# JSON output
bun run src/bin/gate-doctor.ts --all --save-artifact --json

# Test commands (Bun v1.3.13+)
bun test                           # run all tests
bun test --isolate                 # fresh global per file
bun test --parallel                # distribute across all CPUs
bun test --parallel=4              # explicit 4 workers
bun test --shard=1/3               # CI split (deterministic round-robin)
bun test --changed                 # only tests affected by git changes
bun test --changed --watch         # re-filter on every restart
```

## Artifacts

Saved under `var/artifacts/<gate>/<timestamp>.json`. Each envelope includes:

```json
{
  "schemaVersion": 1,
  "gate": "health-check",
  "savedAt": "2026-01-01T12:00:00.000Z",
  "metadata": { "level": 1, "hostname": "...", "pid": 12345, "bunVersion": "1.3.0" },
  "payload": { "status": "pass", "metrics": { "memoryMB": 42, "uptimeSec": 120 } }
}
```

Query from the repo root (if kimi-toolchain is installed):

```bash
kimi-doctor --artifacts-list health-check
kimi-doctor --artifacts-latest strategy-check
```

## Project layout

```
{{name}}/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
└── src/
    ├── bin/
    │   └── gate-doctor.ts    # CLI runner
    ├── gates/
    │   ├── init.ts           # register all gates
    │   ├── registry.ts       # getGate, resolveGateClosure
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

## Configuration

| Variable             | Default         | Effect                    |
| -------------------- | --------------- | ------------------------- |
| `KIMI_ARTIFACTS_DIR` | `var/artifacts` | Artifact output directory |

## Extend

See `docs/extend.md` for adding new gates, L3 governance gates, and integrating with the Herdr orchestrator.

## Related

- [examples/trading-workspace/](../../../examples/trading-workspace/) — Full 4-gate L1→L2 loop with real metrics
- [examples/artifact-trading-loop.md](../../../examples/artifact-trading-loop.md) — Alex the quant narrative
- [examples/control-plane-layers.md](../../../examples/control-plane-layers.md) — L0–L3 retention model
- [examples/artifact-dependency-graphs.md](../../../examples/artifact-dependency-graphs.md) — lineage vs execution DAG
- [Bun v1.3.13 release notes](https://bun.com/blog/bun-v1.3.13) — test parallelism, isolated linker, SHA3, range requests, 5% less memory
