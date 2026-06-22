---
title: "Dependency Graphs Developer Workflow"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Dependency Graphs — Developer Workflow

Day-to-day experience working with **gate execution graphs** (orchestration) and
**artifact lineage graphs** (data provenance) in kimi-toolchain.

Related: [artifact-dependency-graphs.md](artifact-dependency-graphs.md),
[control-plane-layers.md](control-plane-layers.md),
[artifact-trading-loop.md](artifact-trading-loop.md).

## Two Graphs, Two Jobs

| Graph                | Question it answers                 | When                         |
| -------------------- | ----------------------------------- | ---------------------------- |
| **Gate dependency**  | What runs before what?              | Before/during gate execution |
| **Artifact lineage** | What files did this result consume? | After `--save-artifact`      |

Keep them separate. Gate `dependsOn` drives the runner; artifact `dependsOn`
metadata records inputs at save time.

## Daily Workflow

| Activity                 | How                             | Command / API                                                        | Frequency               |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| Declare gate order       | `dependsOn` + `level` on `Gate` | `src/gates/*.ts`                                                     | When adding gates       |
| Preview execution order  | Topological plan, no run        | `kimi-doctor --gate perf-gate --dryrun`                              | When debugging order    |
| Visualize execution DAG  | Mermaid to stdout               | `kimi-doctor --gate-graph --gate perf-gate`                          | Before risky runs       |
| Run gate + deps          | Closure runs in order           | `kimi-doctor --gate perf-gate --save-artifact`                       | Daily / CI              |
| Run all built-in gates   | Full registry topological run   | `kimi-doctor --run-gates --save-artifact`                            | CI / health audits      |
| List saved artifacts     | Chronological paths             | `kimi-doctor --artifacts-list perf-gate`                             | As needed               |
| Inspect latest payload   | Newest JSON                     | `kimi-doctor --artifacts-latest bunfig-policy`                       | Debugging               |
| View declarative lineage | Mermaid from saved `dependsOn`  | `kimi-doctor --artifact-graph perf-gate`                             | When inputs matter      |
| View runtime lineage     | Mermaid from runner provenance  | `kimi-doctor artifacts lineage perf-gate` (or `--artifacts-lineage`) | After `--save-artifact` |
| Observe (read-only)      | Dashboard + serve-probe         | Herdr `GET /api/gates/graph`, `GET /api/artifacts/:gate/lineage`     | Local dev               |

## Declaring Gate Dependencies (Code)

Built-in example — `perf-gate` (L2) depends on `bunfig-policy` (L3):

```ts
// src/gates/perf-gate.ts
export const perfGateDefinition: Gate = {
  name: "perf-gate",
  level: 2,
  dependsOn: ["bunfig-policy"],
  run: async (opts) => {
    // opts.getArtifact?.("bunfig-policy") — current run or latest saved file
    // ...
  },
};
```

Built-in L2 demo (`src/gates/strategy-performance.ts`, `src/gates/model-drift.ts`):

```ts
export const modelDriftGateDefinition: Gate = {
  name: "model-drift",
  level: 2,
  dependsOn: ["strategy-performance"],
  run: async (opts) => {
    const perf = await opts.getArtifacts?.("strategy-performance", {
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      limit: 30,
    });
    // compute drift from perf payloads; save with declarative dependsOn when needed
  },
};
```

Full L1+L2 trading tree: `templates/modules/trading/` via `KIMI_MODULES=trading`
(`trading-doctor` CLI). See [artifact-trading-loop.md](artifact-trading-loop.md).

`ArtifactStore.save()` auto-generates `lineageMermaid` when `dependsOn` is set.

## CLI Cheat Sheet (Live Today)

```bash
# Execution order (Mermaid) for one gate's closure
kimi-doctor --gate-graph --gate perf-gate
# bunfig-policy[bunfig-policy] --> perf-gate[perf-gate]

# Plan without running
kimi-doctor --gate perf-gate --dryrun --json

# Run closure + persist artifacts (+ gate-graph artifact when multiple gates)
kimi-doctor --gate perf-gate --save-artifact

# Run all built-in gates in topological order
kimi-doctor --run-gates --save-artifact

# Declarative lineage (saved dependsOn metadata) — newest perf-gate artifact
kimi-doctor --artifact-graph perf-gate

# Runtime lineage (runner-injected metadata.lineage after gate closure)
kimi-doctor artifacts lineage perf-gate
kimi-doctor --artifacts-lineage perf-gate --json

# Specific artifact file (both graph modes accept --artifact-path)
kimi-doctor --artifact-graph perf-gate \
  --artifact-path .kimi/artifacts/perf-gate/2026-06-19T12-00-00-000Z.json

# JSON for agents / dashboards
kimi-doctor --artifact-graph perf-gate --json
kimi-doctor --gate-graph --gate perf-gate --json

# Redirect Mermaid to a file (reviews, PRs)
kimi-doctor --gate-graph --gate perf-gate > docs/perf-gate-order.mmd
```

> **Note:** There is no unified `kimi-doctor graph` subcommand — use the flags
> below. Lineage has two paths:
>
> | Intent                                                | Command                                                    |
> | ----------------------------------------------------- | ---------------------------------------------------------- |
> | Declarative inputs (`dependsOn` at save)              | `--artifact-graph <gate>`                                  |
> | Runtime provenance (upstream artifacts from last run) | `artifacts lineage <gate>` or `--artifacts-lineage <gate>` |
> | Execution order only                                  | `--gate-graph --gate <gate>`                               |

## Debugging Flow

When a gate result looks wrong:

1. Run the gate with artifacts: `kimi-doctor --gate perf-gate --save-artifact`
2. Runtime provenance: `kimi-doctor artifacts lineage perf-gate`
3. Declarative inputs (if gate saves `dependsOn`): `kimi-doctor --artifact-graph perf-gate`
4. Drill in: `kimi-doctor --artifacts-latest bunfig-policy` (or `--artifacts-list`)

This shifts investigation from log grep to **graph traversal**.

## Visualization by Environment

| Environment         | Gate execution DAG                    | Artifact lineage                                                               |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| **Local CLI**       | `--gate-graph` → Mermaid              | `--artifact-graph` (declarative) or `artifacts lineage` (runtime)              |
| **Herdr dashboard** | `GET /api/gates/graph?gate=perf-gate` | `GET /api/artifacts/:gate/lineage` (not on serve-probe — dashboard/Herdr only) |
| **serve-probe**     | — (ADR-0004: no gate execution)       | `GET /api/artifacts/:gate/latest` only — no `/lineage`                         |
| **PR / docs**       | Paste `.mmd` in Markdown              | Paste Mermaid from `--artifact-graph` or `artifacts lineage`                   |
| **Future**          | —                                     | Interactive Cytoscape.js in dashboard                                          |

## Control Plane — What Each Level Cares About

| Level             | Primary graph           | Developer focus                                 |
| ----------------- | ----------------------- | ----------------------------------------------- |
| **L1** Tactical   | Gate order (simple DAG) | "Did monitors run first?"                       |
| **L2** Strategic  | Artifact lineage        | "Which performance files fed this drift score?" |
| **L3** Governance | Full cross-level audit  | "What policy inputs produced this report?"      |

Built-in mapping: `card-probe` / `tls-compliance` → L1; `perf-gate`,
`strategy-performance`, `model-drift` → L2; `bunfig-policy` → L3.

## Alex the Trader (Dev Session)

1. Uses built-in `strategy-performance` → `model-drift` closure (registry in `src/gates/registry.ts`).
2. Verifies order: `kimi-doctor --gate-graph --gate model-drift`
3. Runs: `kimi-doctor --gate model-drift --save-artifact`
4. Opens Herdr → lineage card from `/api/artifacts/model-drift/lineage`
5. Suspicious drift → `--artifact-graph model-drift` → clicks through resolved paths

## Current vs Roadmap

| Capability                                  | Status                    |
| ------------------------------------------- | ------------------------- |
| Gate `dependsOn` + topological run          | ✅ `src/gates/runner.ts`  |
| `--gate` closure + `--run-gates`            | ✅ `kimi-doctor`          |
| `--dryrun` execution plan                   | ✅                        |
| `--gate-graph` Mermaid                      | ✅                        |
| Artifact `dependsOn` metadata               | ✅ `ArtifactStore.save()` |
| Auto `lineageMermaid` on save               | ✅                        |
| `--artifact-graph` Mermaid                  | ✅                        |
| `artifacts lineage` / `--artifacts-lineage` | ✅                        |
| Herdr lineage + gate graph API              | ✅ (not serve-probe)      |
| `listDependents` (reverse impact)           | 🔜                        |
| Stable artifact IDs                         | 🔜                        |
| Interactive graph UI (Cytoscape)            | 🔜                        |
| `kimi-doctor graph` unified subcommand      | 🔜 (flags work today)     |

## References

- Gates: `src/gates/types.ts`, `src/gates/runner.ts`, `src/gates/registry.ts`
- Lineage: `src/lib/artifact-store.ts`, `src/lib/graph-to-mermaid.ts`
- CLI: `src/bin/kimi-doctor.ts`
- Dashboard: `src/lib/herdr-dashboard-data.ts`, `src/lib/herdr-dashboard-server.ts`
- Read-only probe: `docs/adr/ADR-0004-serve-probe-readonly.md`
## Related

- [INDEX.md](../INDEX.md) — Documentation index
