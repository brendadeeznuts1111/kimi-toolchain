# Control Plane Layers — Artifact Architecture

How to think about gates and artifacts as a **multi-level control plane** instead
of a flat list of checks.

See also: [artifact-trading-loop.md](artifact-trading-loop.md) for a concrete
trading-domain walkthrough; [artifact-dependency-graphs.md](artifact-dependency-graphs.md)
for data lineage between saved artifacts;
[dependency-graphs-developer-workflow.md](dependency-graphs-developer-workflow.md) for
daily CLI and dashboard usage.

## Layer Model

| Level  | Name       | Purpose                             | Cadence           | Produces                    | Control style |
| ------ | ---------- | ----------------------------------- | ----------------- | --------------------------- | ------------- |
| **L0** | Execution  | Raw activity (ticks, fills, orders) | Real-time         | Events (not artifacts)      | Reactive      |
| **L1** | Tactical   | Health & safety                     | Seconds → minutes | Small, frequent artifacts   | Fast feedback |
| **L2** | Strategic  | Performance & drift                 | Hours → daily     | Richer analysis artifacts   | Analytical    |
| **L3** | Governance | Policy & compliance                 | Daily → weekly    | High-value policy artifacts | Deliberate    |

**L0 stays out of `ArtifactStore`.** Artifacts begin at L1 summaries of L0
activity. That prevents the store from becoming a tick dump.

## Artifact Flow

```
L0 (Execution) — events / streams, not .kimi/artifacts/
   ↓
L1 (Tactical)  — card-probe, tls-compliance; trading scaffold adds data-freshness, risk-limits
   ↓
L2 (Strategic) — strategy-performance, model-drift, perf-gate; trading scaffold adds backtest-vs-live
   ↓
L3 (Governance)— bunfig-policy, retention reports, model governance
```

## Retention by Level (recommended defaults)

| Level | Suggested max age | Rationale                |
| ----- | ----------------- | ------------------------ |
| L1    | 7 days            | High volume, fast decay  |
| L2    | 30 days           | Trend analysis window    |
| L3    | 180 days          | Audit and policy history |

Pass the gate's control-plane `level` to pick a default max age:

```ts
await store.prune("card-probe", { level: 1 }); // 7 days
await store.prune("perf-gate", { level: 2 }); // 30 days
await store.prune("bunfig-policy", { level: 3 }); // 180 days
```

Ages come from `GATE_LEVEL_PRUNE_MS` in `src/gates/types.ts`. Override with
`maxAgeMs` when a gate needs a custom window.

## Toolchain Gate Mapping (today)

| Gate             | Level | Cadence          |
| ---------------- | ----- | ---------------- |
| `card-probe`            | L1    | Minutes          |
| `tls-compliance`        | L1    | On demand        |
| `strategy-performance`  | L2    | Daily (demo)     |
| `model-drift`           | L2    | After strategy-performance |
| `perf-gate`             | L2    | Hours / daily    |
| `bunfig-policy`         | L3    | On config change |

## Two Dependency Rules (Do Not Conflate)

### Gate execution order (`Gate.dependsOn`)

Controls **what runs before what**. The runner topologically sorts and may run a
higher-level policy gate before a lower-level check when policy must pass first:

- `perf-gate` (L2) → `dependsOn: ["bunfig-policy"]` (L3) is valid orchestration
- `card-probe` (L1) has no gate dependencies

No level-direction validation today — only cycle detection.

### Artifact lineage (`metadata.dependsOn` on save)

Controls **what data a saved artifact consumed**. Dependencies should flow
**up** the control plane:

- L2 artifacts may declare inputs from L1 and L2 gates
- L3 artifacts may declare inputs from L1 + L2
- L1 artifacts rarely declare upstream artifact deps

Future: validate artifact `dependsOn` direction at save time; gate-order rules
stay separate.

## Observation vs Execution (ADR-0004)

`kimi-doctor --serve-probe` is **read-only** at every level:

- `GET /api/artifacts` — inspect saved artifacts
- `POST /api/artifacts/:gate/refresh` — **403** (disabled)

Fresh artifacts require explicit CLI runs:

```bash
kimi-doctor --gate bunfig-policy --save-artifact
```

## Phased Rollout

| Phase     | Change                                                  | Status  |
| --------- | ------------------------------------------------------- | ------- |
| **Now**   | `level` on built-in gates; `prune({ level })` defaults  | Done    |
| **Next**  | `GET /api/artifacts?level=N`; artifact direction checks | Planned |
| **Later** | Gate-order validation; `listDependents` reverse graph   | Planned |

## References

- ADR: `docs/adr/ADR-0004-serve-probe-readonly.md`
- Store: `src/lib/artifact-store.ts`
- Gates: `src/gates/types.ts`, `src/gates/runner.ts`
- Serve-probe: `src/lib/card-probe-server.ts`
