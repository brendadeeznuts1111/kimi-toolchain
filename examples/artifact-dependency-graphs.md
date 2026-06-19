# Artifact Dependency Graphs

Data lineage across saved artifacts — distinct from **gate dependency graphs**
(execution order).

| Aspect    | Gate dependency graph                                    | Artifact dependency graph                                              |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Describes | What runs before what                                    | What data an artifact consumed                                         |
| When      | Runtime orchestration                                    | After save — analysis & audit                                          |
| Example   | `model-drift` gate `dependsOn: ["strategy-performance"]` | A `model-drift` artifact used the last 30 `strategy-performance` files |
| Today     | `src/gates/runner.ts` + `--gate-graph`                   | `ArtifactStore` metadata + `--artifact-graph`                          |

Related: [control-plane-layers.md](control-plane-layers.md),
[artifact-trading-loop.md](artifact-trading-loop.md),
[dependency-graphs-developer-workflow.md](dependency-graphs-developer-workflow.md).

## Why It Matters

Artifacts form lineage over time:

- `model-drift` (L2) → last 30 `strategy-performance` artifacts
- `backtest-vs-live` (L2) → live performance + historical backtest artifacts
- `governance-report` (L3) → aggregated L2 artifacts

Questions this answers:

- If this `strategy-performance` file is wrong, what else is affected?
- What inputs produced this `model-drift` signal?
- Is it safe to retrain from current artifacts?

## Level 1 — Declarative `dependsOn` (implemented)

Gates declare inputs **at save time** (not inferred later):

```ts
await store.save("model-drift", driftResult, {
  dependsOn: [
    { gate: "strategy-performance", since: "2026-05-20", limit: 30 },
    { gate: "backtest-performance", since: "2026-01-01" },
  ],
});
```

Retrieve and resolve:

```ts
const relativePath = store.relativePath(absolutePath);
const queries = await store.getDependencies(relativePath);
const resolved = await store.resolveDependsOn(queries);
// resolved[0].paths → concrete .kimi/artifacts/... paths
```

Pinned paths (exact lineage):

```ts
dependsOn: [
  {
    gate: "strategy-performance",
    paths: [".kimi/artifacts/strategy-performance/2026-06-19T12-00-00-000Z.json"],
  },
];
```

## Alex the Trader — Lineage Sketch

```
model-drift (L2)
   ├── strategy-performance × 30 (L2)
   └── training-metadata (L3)

backtest-vs-live (L2)
   ├── strategy-performance (recent, L2)
   └── backtest-performance (historical, L3)

governance-report (L3)
   └── model-drift + backtest-vs-live (L2)
```

Dependencies should flow **up** the control plane (L2 reads L1/L2; L3 reads L2).

## Gate vs Artifact Graphs — Keep Separate

| System               | Scope                                         |
| -------------------- | --------------------------------------------- |
| Gate `dependsOn`     | Orchestration — runner blocks until deps pass |
| Artifact `dependsOn` | Lineage — audit trail of consumed files       |

A gate graph says _run order_. An artifact graph says _data used_. They align
conceptually but serve different consumers (runner vs agents/dashboard).

## Mermaid export

```bash
# Gate execution DAG (orchestration)
kimi-doctor --gate-graph
kimi-doctor --gate perf-gate --gate-graph --json

# Run with upstream lineage capture (--save-artifact persists metadata.lineage)
kimi-doctor --gate perf-gate --save-artifact

# Trace back (tree + Mermaid)
kimi-doctor artifacts lineage perf-gate --json
kimi-doctor --artifacts-lineage perf-gate --json
kimi-doctor --artifact-graph model-drift --json
```

Runtime provenance (`metadata.lineage.dependencies` + `upstreamArtifacts`) is injected by
`runGatesWithDependencies()` after upstream gates complete. Declarative `dependsOn` queries
are separate — audit-oriented, saved at write time.

Herdr dashboard **Lineage** tab: `GET /api/gates/graph` (execution DAG) and
`GET /api/artifacts/:gate/lineage` (artifact panel). The API returns
`lineageSource`: `runtime` (gate-run `metadata.lineage`), `declarative` (`dependsOn`),
`stored` (pre-rendered `lineageMermaid`), or `none`.

Saved artifacts with `dependsOn` embed `metadata.lineageMermaid` at write time.
Gate runs with `--save-artifact` embed `metadata.lineage` (upstream artifact paths).

## Roadmap

| Level  | Capability                                                     | Status |
| ------ | -------------------------------------------------------------- | ------ |
| **1**  | Store `dependsOn`; `getDependencies` + `resolveDependsOn`      | Done   |
| **1b** | `lineageMermaid` on save; `--artifact-graph`; Herdr `/lineage` | Done   |
| **2**  | `listDependents` (reverse impact), level-filtered API          | Future |
| **3**  | Stable artifact IDs, interactive Cytoscape graphs              | Future |

## References

- `src/lib/artifact-store.ts` — `buildLineageGraph`, `parseArtifactDependencies`
- `src/lib/graph-to-mermaid.ts` — `generateArtifactLineageMermaid`
- `src/gates/runner.ts` — `generateGateGraph` (gate execution DAG)
- `test/graph-to-mermaid.unit.test.ts`, `test/artifact-store.unit.test.ts`
