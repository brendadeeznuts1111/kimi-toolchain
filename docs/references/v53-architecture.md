# v5.3 Architecture — Consolidated Reference

> Locked spec: `kimi-fix --profile toolchain` (2026-06-19)
> Memory: `kimi-fix-profile-v53-spec`

## Self-Calibrating Loop

```
Symbol contract (kimi.effect.*)
        ↓
Static scan (transpiler-scan.ts discovers handlers)
        ↓
Runtime registration (globalThis[Symbol.for("kimi.effect.*")])
        ↓
Nanosecond measurement (Bun.nanoseconds() per method)
        ↓
kimi-doctor --train writes thresholds.json (actualMs × 1.1)
        ↓
kimi-doctor --perf-gates enforces the thresholds
        ↓
kimi-doctor --report generates perf-report.html
```

## Complete File Map

The toolchain profile is implemented directly in the repo tree; there is no consolidated archive to split.

| #   | File                                               | Contents                                                  |
| --- | -------------------------------------------------- | --------------------------------------------------------- |
| 1   | `src/bin/kimi-fix.ts`                              | Scaffold CLI; `--profile app\|toolchain` + `KIMI_MODULES` |
| 2   | `src/lib/scaffold-profiles.ts`                     | Profile resolution, `dx.config.*.toml` rendering          |
| 3   | `src/lib/scaffold-modules.ts`                      | `KIMI_MODULES` copy tree + package script merging         |
| 4   | `templates/scaffold/dx.config.toolchain.toml`      | Herdr + finish-work layout for toolchain projects         |
| 5   | `templates/scaffold/scripts/finish-work.ts`        | Gate → commit/push close-loop runner                      |
| 6   | `templates/scaffold/scripts/finish-work-herdr.ts`  | Herdr reviewer-pane escalation helpers                    |
| 7   | `templates/scaffold/scripts/finish-work-config.ts` | Per-project finish-work gate configuration                |
| 8   | `templates/scaffold/scripts/reviewer-pane.ts`      | Cross-pane review helper                                  |
| 9   | `examples/dashboard/src/harness/`                  | Perf harness + `perf-doctor.ts` (default `doctor` module) |
| 10  | `templates/modules/*`                              | Domain effects: image, clock, uuid, http, db, terminal    |

## Profiles

| Profile     | Gates                                              | Follow-Up                            | Watch Patterns                   |
| ----------- | -------------------------------------------------- | ------------------------------------ | -------------------------------- |
| `toolchain` | check:fast, effect-gates, perf-gates, effect-audit | Domain drift detection, method count | `src/effect/**`, `src/domain/**` |
| `minimal`   | check:fast                                         | None                                 | None                             |
| `ci`        | check:fast, test, perf-gates, publish:dry          | None                                 | None                             |

```bash
bun run src/bin/kimi-fix.ts --profile toolchain          # Full validation
bun run src/bin/kimi-fix.ts --profile toolchain --watch  # Herdr tab
bun run src/bin/kimi-fix.ts --profile minimal            # Quick gate
bun run src/bin/kimi-fix.ts --profile ci                 # CI pipeline
```

## Command Aliases (auto-wired in scaffold)

```bash
bun run doctor:gate    # CI threshold check
bun run doctor:train   # Calibrate thresholds.json
bun run doctor:watch   # Dev mode with fs.watch
```

## DEFAULT_MODULES — Opt-Out Instead of Opt-In

```ts
export const DEFAULT_MODULES = ["trace", "perf"];

// KIMI_MODULES=image → includes trace, perf, image
// KIMI_MODULES=image,-perf → includes trace, image (excludes perf)
// KIMI_MODULES=+image → includes only image (no defaults)
```

`resolveModules(input: string): string[]` — `+` prefix skips defaults, `-` prefix excludes specific modules.

## Module Registry (8 entries)

```ts
// src/domain/registry.ts
export const MODULE_REGISTRY: Record<string, ModuleEntry> = {
  trace: {
    files: ["trace/validation.ts", "trace/format.ts"],
    importPath: "./trace/format",
    initSymbol: "kimi.trace",
    default: true,
  },
  perf: {
    files: [
      "harness/perf-monitor.ts",
      "harness/html-reporter.ts",
      "harness/transpiler-scan.ts",
      "guardian/perf-gate.ts",
      "guardian/effects.ts",
      "bin/kimi-doctor.ts",
      "bin/kimi-fix.ts",
      "bin/kimi-heal.ts",
    ],
    importPath: "./harness/perf-monitor",
    initSymbol: "kimi.perf",
    default: true,
  },
  snapshots: {
    files: ["snapshots/snapshot-helper.ts"],
    importPath: "./snapshots/snapshot-helper",
    initSymbol: "kimi.snapshot",
  },
  logging: {
    files: ["logging/logger.ts"],
    importPath: "./logging/logger",
    initSymbol: "kimi.logger",
  },
  performance: {
    files: ["performance/marks.ts"],
    importPath: "./performance/marks",
    initSymbol: "kimi.perfMark",
  },
  image: {
    files: ["image/processor.ts"],
    importPath: "./image/processor",
    initSymbol: "kimi.effect.image",
    thresholdMs: 200,
  },
  clock: {
    files: ["effect/clock.ts"],
    importPath: "./effect/clock",
    initSymbol: "kimi.effect.clock",
    thresholdMs: 0.01,
  },
  uuid: {
    files: ["effect/uuid.ts"],
    importPath: "./effect/uuid",
    initSymbol: "kimi.effect.uuid",
    thresholdMs: 0.1,
  },
};
```

## Effect Audit (Dimension 8)

| Check             | Severity | Rule                                          |
| ----------------- | -------- | --------------------------------------------- |
| `missing-symbol`  | error    | `EFFECT_PIPELINE` Symbol not registered       |
| `bare-promise`    | error    | `Promise.resolve()` without `Effect.` wrapper |
| `no-tag-service`  | error    | Domain file imports `getEffect` directly      |
| `circular-import` | error    | Circular layer dependency detected            |

```bash
bun run src/bin/kimi-heal.ts --effect-audit
```

## Card Dashboard (#34–#42)

| #   | Card            | Status | Commands                                                |
| --- | --------------- | ------ | ------------------------------------------------------- |
| 34  | snapshot helper | ✓      | `snapshot(label, data, opts)`                           |
| 35  | coverage gate   | ✓      | `test:coverage`                                         |
| 36  | isolate verify  | ◌      | —                                                       |
| 37  | diff reporter   | ◐      | —                                                       |
| 39  | table status    | ✓      | —                                                       |
| 40  | kimi-doctor CLI | ✓      | `doctor`, `doctor:gate`, `doctor:train`, `doctor:watch` |
| 41  | clock module    | ✓      | —                                                       |
| 42  | uuid module     | ✓      | —                                                       |

## Herdr Integration

```toml
# dx.config.toolchain.toml (toolchain profile)
[finishWork]
gates = ["bun run check:fast", "kimi-doctor --effect-gates", "kimi-doctor --automation"]

[doctor]
tabs = [
  { name = "probe", command = "kimi-doctor --serve-probe" },
  { name = "bunfig", command = "kimi-doctor --gate bunfig-policy" },
]

[doctor.probe]
port = 5678
interval = 15000
```

## Output Example

```
🔧 Running kimi-toolchain v5.3 profile
  scripts/check.ts --fast ... ✅
  src/bin/kimi-doctor.ts --effect-gates ... ✅
  src/bin/kimi-doctor.ts --perf-gates ... ✅
  src/bin/kimi-heal.ts --effect-audit ... ❌

❌ 3/4 gates passed

type              file                    message
─────────────────────────────────────────────────────────────
bare-promise      src/effect/db.ts        query: bare Promise detected — wrap in Effect
no-tag-service    src/domain/order.ts     validate: domain imports effect directly — pass as arg
```

## Implementation Status

| Layer                                    | Implemented                               | Aspirational               |
| ---------------------------------------- | ----------------------------------------- | -------------------------- |
| `app`/`toolchain` profiles               | ✓ `src/bin/kimi-fix.ts`                   |                            |
| `image/processor.ts` (template)          | ✓ `templates/modules/`                    |                            |
| `perf-gate.ts`                           | ✓ `src/guardian/`                         |                            |
| `html-reporter.ts`                       | ✓ `src/harness/`                          |                            |
| `symbols.ts`                             | ✓ `examples/dashboard/src/lib/`           |                            |
| `minimal`/`ci` profiles                  |                                           | ✗                          |
| Effect/perf gates as profile steps       |                                           | ✗                          |
| `--watch` mode                           |                                           | ✗                          |
| `resolveModules()` + `MODULE_REGISTRY`   |                                           | ✗                          |
| `kimi-heal --effect-audit` (Dimension 8) |                                           | ✗                          |
| Clock, uuid, trace, snapshots modules    |                                           | ✗                          |
| 42-card dashboard UI                     |                                           | ✗                          |
| Herdr dx.config.toml integration         |                                           | ✗                          |
| Canvas ↔ card wiring (unified UI)        | partial (steps 1–5 on examples/dashboard) | combined Herdr+examples UI |

### Canvas ↔ card wiring (v5.4)

**Current state (v5.3):**

- **Canvases** — manifest-backed companions in `docs/canvases/`, registered via `cursorCanvas` in `canonical-references.toml` (`LOCAL_DOC_REFERENCES`). Served by `GET /api/canvases` on the Herdr orchestrator dashboard. Static design docs with `CANVAS_ROUTING` cross-links; clicking a row opens the canvas file in the IDE (`open-canvas` IPC), not a runtime filter.
- **Cards** — ~64 independent `<div class="card" id="card-*">` panels in `examples/dashboard/src/dashboard.html`, each fetching its own `/api/*` route. No unified `/api/cards` endpoint, no single pass/fail status table, no manifest field mapping `canvasId` → `cardId`.
- **Gates** — `kimi-doctor --effect-gates`, `perf-doctor --perf-gates`, etc. emit CLI/JSON separately from both layers.

Canvases document **what/why**; cards probe **runtime behavior**. The relationship is conceptual in v5.3, not machine-enforced.

**Target (v5.4):** one traceable chain — canvas (design) → manifest id → code/gate → card (live status) — with click-to-filter in a combined or bridged dashboard.

| Step | Deliverable                                                                              |
| ---- | ---------------------------------------------------------------------------------------- |
| 1    | `cardId` registry derived from `dashboard.html` `id="card-*"` (lint or generate script)  |
| 2    | `canvasInfluences?: string[]` on `LOCAL_DOC_REFERENCES` rows (manifest SSOT)             |
| 3    | `GET /api/cards` returning aggregated card states (examples/dashboard or unified server) |
| 4    | Extend `GET /api/canvases` payload with `influences` per entry                           |
| 5    | Dashboard UI: `?canvas=deep-quality` (or click) highlights matching card panels          |

**Prerequisite:** step 1 before step 2 — influences must reference real card ids, not hand-guessed labels.

**Shipped (v5.4 slice):**

| Step | Status | Artifact                                                                  |
| ---- | ------ | ------------------------------------------------------------------------- |
| 1    | ✓      | `src/lib/dashboard-card-registry.ts` parses `dashboard.html` `card-*` ids |
| 2    | ✓      | `canvasInfluences` on all 9 `LOCAL_DOC_REFERENCES` canvas rows            |
| 3    | ✓      | `GET /api/cards` on `examples/dashboard`                                  |
| 4    | ✓      | `influences` on `GET /api/canvases` (Herdr + examples)                    |
| 5    | ✓      | Canvas filter bar + `?canvas=` highlight on `examples/dashboard`          |
| —    | ✗      | Single combined dashboard (Herdr agents + examples cards)                 |

Lint: `bun run scripts/lint-canvas-influences.ts` (gate: `canvas-influences` in `bun run lint`).

**Example mapping (in manifest via `canvasInfluences`):**

| Canvas                       | Manifest id    | Candidate `canvasInfluences`                      |
| ---------------------------- | -------------- | ------------------------------------------------- |
| `kimi-fix`                   | `templates`    | `card-scaffold`, `card-kimi-doctor`, `card-gates` |
| `kimi-heal-doctor-scaffold`  | `deep-quality` | `card-gates`, `card-effect-image`                 |
| `herdr-dashboard-automation` | `kimi-doctor`  | `card-kimi-doctor`                                |

### v5.5 operator surface (shipped)

Builds on v5.4 registry + `/api/cards`. Deep links use canvas manifest ids (`artifact-lineage`, `gate-health`): `?canvas=artifact-lineage&runId=run_*`.

| Priority | Deliverable                   | Status                                                                                                                                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **Hub card status probes**    | **Shipped** — 7 cards via `HUB_CARD_PROBE_IDS`; in-process handlers + parallel route probes (`probeAllRegistryRoutes`)                                                                      |
| 2        | **Deep-link reactive canvas** | **Shipped** — `dashboard-canvas-filter.ts`, `artifact-lineage.manifest.ts`, `GET /api/canvas-filter`, run/diff/session actions; `dashboard.html` `fetchAndApplyCanvasDeepLink()`            |
| 3        | **Run manifest APIs**         | **Shipped** — `fetchDashboardRunsList` / `fetchDashboardRunManifest` on examples dashboard + Herdr server (`handlers/artifacts.ts`)                                                         |
| 4        | **Structured HTTP audit**     | **Shipped** — `examples-dashboard-events.jsonl` via `dashboard-logger.ts` (see `error-log-discovery` sink `examples-dashboard-events`)                                                      |
| 5        | **Herdr bridge**              | **Shipped** — `herdr-dashboard-bridge.ts`; `/api/canvases` `dashboardDeepLink`; Canvases tab **Examples** column; run-aware links via `artifactsRunFilter` → `?canvas=<manifestId>&runId=…` |
| 6        | **Unified surface**           | Not started — single tab Herdr + examples cards                                                                                                                                             |

Hub probes: `card-gates`, `card-kimi-doctor`, `card-scaffold`, `card-perf-harness`, `card-perf-registry`, `card-effect-benchmark`, `card-symbols`. Non-hub cards use loopback GET probes (`x-kimi-dashboard-probe: 1`).

Regression: `test/examples-dashboard-canvas-filter.unit.test.ts`, `test/dashboard-canvas-filter.unit.test.ts`, `test/herdr-dashboard-bridge.unit.test.ts`.

Out of scope: live status for all 69 cards, combined Herdr+examples layout.

## Related

| Topic                         | Path                                                 |
| ----------------------------- | ---------------------------------------------------- |
| Memory (canonical spec)       | `kimi-fix-profile-v53-spec`                          |
| v5.3 README                   | `examples/dashboard/v53/README.md`                   |
| Doctor CLI + effects pipeline | [kimi-doctor.md](./kimi-doctor.md)                   |
| Template families             | [template-matrix.md](./template-matrix.md)           |
| Configuration layers          | [configuration-layers.md](./configuration-layers.md) |
| Namespace boundaries          | [namespace.md](./namespace.md)                       |
| Image effect example          | `examples/image-effect.md`                           |
| Platform absorption           | `examples/platform-absorption.md`                    |
