---
title: "README"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Artifact Portal Example

One-command synthesis demo for **Canvas → serve-probe → Herdr → ArtifactStore**. Every surface shares the same `BenchmarkApiEnvelope`; `bun run build:portal` persists diagnostics and a portal manifest under `.kimi/artifacts/artifact-portal/`.

Narrative walkthrough: [artifact-portal.md](../artifact-portal.md). Contract: [contracts/artifact-portal.json](../../contracts/artifact-portal.json).

## Flow

```
benchmark.canvas (?canvas=benchmark)
        ↓
Dashboard + serve-probe → BenchmarkApiEnvelope (metadata.convergence)
        ↓
build:portal / Herdr benchmark-portal action
        ↓
.kimi/artifacts/artifact-portal/  (diagnostics + converged manifest)
```

## Converged components

| Component | Wired via                                                 | Verify                        |
| --------- | --------------------------------------------------------- | ----------------------------- |
| Canvas    | `benchmark.manifest.ts` → envelope `metadata.convergence` | `?canvas=benchmark`           |
| Dashboard | `effect-benchmark.ts` → `runEffectBenchmarkCardLoop`      | `GET /api/effect-benchmark`   |
| Herdr     | `benchmark-portal.ts` → `buildArtifactPortal()`           | plugin JSON `converged: true` |

One `bun run portal:local` (or `build:portal --local-only`) publishes a manifest whose `convergedComponents` lists all three with zero duplicate loops.

## Start (offline — no dashboard required)

```bash
cd examples/portal

# Publish portal artifacts (local benchmark loop fallback)
bun run portal:local

# Machine-readable build report
bun run portal:json | jq '.benchmark.source, .portalIndexPath'

# Convergence smoke test
bun run verify

# List saved portal envelopes
bun run status
```

Equivalent from repo root:

```bash
bun run build:portal --local-only
bun run test:portal-convergence
```

## Start (live probe)

With the examples dashboard on port **5678**:

```bash
cd ~/kimi-toolchain && PORT=5678 bun run dashboard -- --daemon --port=5678
cd examples/portal && bun run portal
curl -s http://127.0.0.1:5678/api/effect-benchmark | jq '.runner, .summary'
```

`bun run portal` tries serve-probe first; on failure it falls back to the local effect-benchmark loop (same as `--local-only`).

## Output

| Artifact kind              | Gate              | Purpose                                                                                            |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `benchmark-diagnostics`    | `artifact-portal` | Full `BenchmarkApiEnvelope` from probe/loop (includes `metadata.testExecution.changedImportGraph`) |
| `artifact-portal-manifest` | `artifact-portal` | Build index — paths, contract, canvas link                                                         |

```bash
kimi-doctor --artifacts-latest artifact-portal
kimi-doctor --artifacts-lineage artifact-portal --json
```

## Dashboard deep link

```
http://127.0.0.1:5678/?example=portal&canvas=benchmark
http://127.0.0.1:5678/?canvas=benchmark
http://127.0.0.1:5678/?canvas=benchmark#card-bun-test
```

Showcase hub: `GET /api/examples?id=portal`

## Herdr plugin

When running inside a Herdr workspace, the `benchmark-portal` plugin action calls `pullBenchmarkEnvelopeAndRegister()` — same registration path as `build:portal`.
## Related

- [INDEX.md](../INDEX.md) — Documentation index
