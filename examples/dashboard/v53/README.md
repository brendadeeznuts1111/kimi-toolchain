# kimi-toolchain v5.3 — Consolidated Profile

> Locked: `kimi-fix --profile toolchain` (2026-06-19)  
> Memory id: `kimi-fix-profile-v53-spec`  
> Full reference: [docs/references/v53-architecture.md](../../../docs/references/v53-architecture.md)

## Self-calibrating loop

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

Threshold layers (lowest wins last): `DEFAULT_THRESHOLDS` → `thresholds.json` → `[doctor.thresholds]` in bunfig → `overrideThresholds()` API.

## v5.3 Source Map

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

## Profile registry

| Profile     | Gates                                              | Follow-up                  | Watch patterns                   |
| ----------- | -------------------------------------------------- | -------------------------- | -------------------------------- |
| `toolchain` | check:fast, effect-gates, perf-gates, effect-audit | Domain drift, method count | `src/effect/**`, `src/domain/**` |
| `minimal`   | check:fast                                         | —                          | —                                |
| `ci`        | check:fast, test, perf-gates, publish:dry          | —                          | —                                |

```bash
bun run src/bin/kimi-fix.ts --profile toolchain          # full validation
bun run src/bin/kimi-fix.ts --profile toolchain --watch  # Herdr tab
bun run src/bin/kimi-fix.ts --profile minimal            # quick gate
bun run src/bin/kimi-fix.ts --profile ci                 # CI pipeline
```

Scaffold aliases (auto-wired):

```bash
bun run doctor:gate    # CI threshold check
bun run doctor:train   # calibrate thresholds.json
bun run doctor:watch   # dev mode with fs.watch
```

## DEFAULT_MODULES (opt-out, not opt-in)

```ts
export const DEFAULT_MODULES = ["trace", "perf"];

// KIMI_MODULES=image        → trace, perf, image
// KIMI_MODULES=image,-perf  → trace, image
// KIMI_MODULES=+image       → image only (no defaults)
```

`resolveModules(input: string): string[]` — `+` skips defaults; `-` excludes a module.

**Scaffold default (shipped):** `KIMI_MODULES` unset → `doctor` module copies perf harness from `examples/dashboard/` via `src/lib/scaffold-modules.ts`.

## MODULE_REGISTRY (8 entries)

| Module      | initSymbol          | default | thresholdMs |
| ----------- | ------------------- | ------- | ----------- |
| trace       | `kimi.trace`        | yes     | —           |
| perf        | `kimi.perf`         | yes     | —           |
| snapshots   | `kimi.snapshot`     | —       | —           |
| logging     | `kimi.logger`       | —       | —           |
| performance | `kimi.perfMark`     | —       | —           |
| image       | `kimi.effect.image` | —       | 200         |
| clock       | `kimi.effect.clock` | —       | 0.01        |
| uuid        | `kimi.effect.uuid`  | —       | 0.1         |

## Card dashboard (#34–#42)

| #   | Card            | Status |
| --- | --------------- | ------ |
| 34  | snapshot helper | ✓      |
| 35  | coverage gate   | ✓      |
| 36  | isolate verify  | ◌      |
| 37  | diff reporter   | ◐      |
| 39  | table status    | ✓      |
| 40  | kimi-doctor CLI | ✓      |
| 41  | clock module    | ✓      |
| 42  | uuid module     | ✓      |

Live demo: `cd examples/dashboard && bun run src/index.ts` → http://localhost:5678

## Manifest canvases (9 companions)

| readOrder | Canvas                              | Manifest id                 |
| --------- | ----------------------------------- | --------------------------- |
| 1         | `kimi-toolchain`                    | `unified`                   |
| 2         | `namespace-boundaries`              | `namespace`                 |
| 3         | `configuration-layers`              | `configuration-layers`      |
| 4         | `doc-links-and-see-ladder`          | `code-references`           |
| 5         | `kimi-fix`                          | `templates`                 |
| 6         | `herdr-dashboard-thumbnails`        | `dashboard-thumbnails`      |
| 7         | `herdr-dashboard-automation`        | `kimi-doctor`               |
| 8         | `herdr-unified-plugin-architecture` | `herdr-plugin-architecture` |
| 9         | `kimi-heal-doctor-scaffold`         | `deep-quality`              |

IDE paths: `docs/canvases/<name>.canvas.tsx` · regenerate: `bun run references:generate`

## Recall the spec

```bash
kimi-memory store kimi-fix-profile-v53-spec   # idempotent re-store
kimi-memory recall kimi-toolchain 5
# session id kimi-fix-profile-v53-spec → key decisions list v5.3 anchors
```
