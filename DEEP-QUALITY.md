# Deep Quality Floor — Effect Discipline

This document is the canonical reference for the Effect-discipline enforcement pipeline. It covers the build-time constants, scanner gates, CLI commands, JSON report shape, session-floor thresholds, and known implementation gaps.

All values listed here are derived from the implementation in `src/lib/effect-gates.ts`, `src/bin/kimi-doctor.ts`, `src/bin/kimi-heal.ts`, `bunfig.toml`, and `error-taxonomy.yml`.

## Build-Time Constants

The following `[define]` constants in `bunfig.toml` control the gates. They are baked at runtime via Bun build-time constants and loaded by `loadThresholds()` in `src/lib/effect-gates.ts`.

| Constant                                   | Domain              | Type                             | Current Value | Purpose                                                                                                 |
| ------------------------------------------ | ------------------- | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `KIMI_EFFECT_MAX_DIRECT_PROMISE`           | `effect-discipline` | `number`                         | `0`           | Maximum allowed bare `Promise` usages before direct-promise findings become errors.                     |
| `KIMI_DOMAIN_PURITY_LEVEL`                 | `effect-discipline` | `"strict" \| "gradual" \| "off"` | `"strict"`    | Whether domain-purity scanning is enabled and at what severity.                                         |
| `KIMI_LAYER_CIRCULARITY_TOLERANCE`         | `effect-discipline` | `number`                         | `0`           | Tolerance for circular Layer/module imports. `0` means any cycle is an error.                           |
| `KIMI_SERVICE_TAG_REQUIRED`                | `effect-discipline` | `boolean`                        | `true`        | When `true`, exported service classes that import `effect` but do not use `Tag` or `Layer` are flagged. |
| `KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED` | `effect-discipline` | `boolean`                        | `true`        | When `true`, `Effect.runPromise` calls outside permitted boundary paths are errors.                     |

> `eventStreamsEnabled` is not a build-time constant. It defaults to `false` and is enabled only by the `--event-streams` CLI flag.

## Threshold Object

The `EffectGatesThresholds` interface baked into every report:

```ts
interface EffectGatesThresholds {
  maxDirectPromise: number; // from KIMI_EFFECT_MAX_DIRECT_PROMISE
  layerCircularityTolerance: number; // from KIMI_LAYER_CIRCULARITY_TOLERANCE
  serviceTagRequired: boolean; // from KIMI_SERVICE_TAG_REQUIRED
  domainPurityLevel: "strict" | "gradual" | "off"; // from KIMI_DOMAIN_PURITY_LEVEL
  runPromiseBoundaryEnabled: boolean; // from KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED
  eventStreamsEnabled: boolean; // default false; CLI override only
}
```

## Scanners and Gate Identifiers

`EFFECT_GATES` in `src/lib/effect-gates.ts` defines these gate identifiers (kept in sync with `error-taxonomy.yml`):

| Identifier             | Scanner                  | Severity Logic                                                                                                                                                                 |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `direct-promise`       | `scanDirectPromises`     | Error by default; downgraded to `warn` when `counts.directPromise <= maxDirectPromise` and `maxDirectPromise > 0`.                                                             |
| `layer-circularity`    | `scanLayerCircularity`   | Error when `layerCircularityTolerance <= 0` and a circular relative import is detected.                                                                                        |
| `missing-service-tag`  | `scanMissingServiceTags` | Error in `strict` mode, `warn` in `gradual` mode, skipped when `off` or `serviceTagRequired === false`. Classes extending `Error` or `Data.TaggedError` are excluded.          |
| `domain-purity`        | `scanDomainPurity`       | Flags `process.env`, `Bun.env`, `fs`, `child_process`, `node:fs`, `node:child_process` in files under `src/domain/`. Error in `strict`, warn in `gradual`, skipped when `off`. |
| `run-promise-boundary` | `scanRunPromiseBoundary` | Error when `runPromiseBoundaryEnabled === true` and `.runPromise` / `.runPromiseExit` is called outside allowed paths.                                                         |
| `event-stream`         | `scanEventStreams`       | Error when `eventStreamsEnabled === true` and the file is under `src/services/` and references `EventEmitter`, `CustomEmitter`, or the `events` module.                        |
| `console-boundary`     | `scanConsoleBoundary`    | Error when `console.log/warn/error/...` appears outside `scripts/` and `src/bin/` (probe fixtures and logger exempt).                                                          |
| `process-env-boundary` | `scanProcessEnvBoundary` | Error when `process.env` appears outside `scripts/` and `src/bin/` (secret-audit catalog and probe fixtures exempt).                                                           |
| `node-fs-plugin`       | `scanNodeFsInPlugin`     | Error when `fs` / `node:fs` is imported under `**/plugins/**` or `**/megaliner/**`.                                                                                            |

### `Effect.runPromise` Boundary

Allowed paths are hardcoded in `RUN_PROMISE_ALLOWED_PATHS`:

- `src/bin/`
- `scripts/`
- `src/lib/effect/`
- `test/`

Plus outer-shell allowlist `OUTER_SHELL_ALLOWED_FILES` / `OUTER_SHELL_ALLOWED_DIRS` (hooks, drift, guardian, deep-audit CLIs) — same boundary policy as `scripts/`.

Any `.runPromise` / `.runPromiseExit` call outside these locations is a `run-promise-boundary` error when the boundary is enabled.

Human-readable audit canon (console/scripts/test/plugin-TOML boundaries): `skills/effect-discipline/references/AUDIT-PROMPT.md`. Companion lint: `scripts/lint-patterns.ts`.

> **Comment and string exclusion:** All regex-based scanners (`direct-promise`, `run-promise-boundary`, `domain-purity`, `event-stream`) pre-compute a set of comment and string/template-literal ranges and skip matches that fall inside them. This prevents JSDoc examples and string literals from being flagged.

### Event-Stream Boundary

Event-stream scanning is **opt-in** via `--event-streams`. When enabled, only files under `src/services/` are scanned for:

- `new EventEmitter`
- `new CustomEmitter`
- `EventEmitter` / `CustomEmitter` references
- `from "events"` or `require("events")`

## CLI Commands

### `kimi-doctor --effect-gates`

Runs all scanners against the project, persists a snapshot to `{projectRoot}/.kimi/var/effect-gates.ndjson`, detects regressions against the previous snapshot, and exits non-zero on errors or regressions.

```bash
kimi-doctor --effect-gates
kimi-doctor --effect-gates --json
kimi-doctor --effect-gates --json --project-root ./some-project
```

Flags:

- `--effect-gates` — Run Effect-discipline scan.
- `--json` — Emit machine-readable JSON.
- `--project-root <path>` — Project to scan (defaults to resolved project root).

### `kimi-doctor --effect-floor`

Evaluates manual effect-floor counts against the hardcoded session floor. Fails closed: missing or invalid flags, negative values, or counts below the floor all return exit code `1`. The legacy flag `--session-report` remains as a deprecated alias for one release cycle.

```bash
kimi-doctor --effect-floor \
  --raw-promises-removed 2 \
  --services-migrated 2 \
  --domain-purity-resolved 1 \
  --raw-errors-converted 1 \
  --event-emitters-converted 0 \
  --circular-layers 0
```

Flags (all required, all expect non-negative integers):

- `--raw-promises-removed`
- `--services-migrated`
- `--domain-purity-resolved`
- `--raw-errors-converted`
- `--event-emitters-converted`
- `--circular-layers`

### `kimi-heal effect audit`

Standalone Effect-discipline audit. Does **not** persist snapshots or compute regressions. Useful for CI or one-off checks.

```bash
kimi-heal effect audit
kimi-heal effect audit --check-tags
kimi-heal effect audit --check-tags --event-streams --json
kimi-heal effect audit --json --project-root ./some-project
```

Flags:

- `--check-tags` — Sets `serviceTagRequired: true` for this run (overrides the build constant).
- `--event-streams` — Enables `event-stream` scanning for files under `src/services/`.
- `--json` — Emit machine-readable JSON.
- `--project-root <path>` — Project to scan.

## JSON Report Shapes

### `EffectGatesReport`

The core report produced by `buildEffectGatesReport()` in `src/lib/effect-gates.ts`:

```ts
interface EffectGatesReport {
  schemaVersion: number; // 1
  tool: string; // e.g. "kimi-doctor" or "kimi-heal"
  generatedAt: string; // ISO 8601 timestamp
  project: string; // project name
  gitHead?: string; // git HEAD hash, if available
  thresholds: EffectGatesThresholds;
  counts: EffectGatesCounts;
  summary: {
    total: number;
    errors: number;
    warnings: number;
  };
  violations: EffectGatesViolation[];
}

interface EffectGatesCounts {
  directPromise: number;
  layerCircularity: number;
  missingServiceTag: number;
  domainPurity: number;
  runPromiseBoundary: number;
  eventStream: number;
}

interface EffectGatesViolation {
  gate: string; // one of EFFECT_GATES values
  severity: "error" | "warn";
  message: string;
  location?: string; // e.g. "src/lib/foo.ts:42"
}
```

### `kimi-doctor --effect-gates --json` envelope

`kimi-doctor` wraps the report with snapshot comparison and the standard JSON envelope (`schemaVersion`, `tool`):

```json
{
  "effectGates": {
    "previous": <EffectGatesReport | null>,
    "current": <EffectGatesReport>,
    "delta": {
      "directPromise": 0,
      "layerCircularity": 0,
      "missingServiceTag": 0,
      "domainPurity": 0,
      "runPromiseBoundary": 0,
      "eventStream": 0
    },
    "regressions": []
  },
  "thresholds": <EffectGatesThresholds>,
  "violations": [],
  "summary": { "ok": true },
  "schemaVersion": 1,
  "tool": "kimi-doctor"
}
```

### `kimi-doctor --effect-floor --json` envelope

```json
{
  "schemaVersion": 1,
  "tool": "kimi-doctor",
  "counts": {
    "rawPromisesRemoved": 2,
    "servicesMigratedToTagLayer": 2,
    "domainPurityViolationsResolved": 1,
    "rawErrorsConvertedToTyped": 1,
    "eventEmittersConvertedToStreams": 0,
    "circularLayerDependencies": 0
  },
  "floor": {
    "passed": true,
    "missing": [],
    "below": [],
    "details": [
      { "field": "rawPromisesRemoved", "actual": 2, "floor": 2 },
      { "field": "servicesMigratedToTagLayer", "actual": 2, "floor": 2 },
      { "field": "domainPurityViolationsResolved", "actual": 1, "floor": 1 },
      { "field": "rawErrorsConvertedToTyped", "actual": 1, "floor": 1 },
      { "field": "eventEmittersConvertedToStreams", "actual": 0, "floor": 0 },
      { "field": "circularLayerDependencies", "actual": 0, "floor": 0 }
    ]
  },
  "summary": {
    "passed": true,
    "missing": [],
    "below": []
  }
}
```

When validation fails (missing/invalid/below floor), `summary.passed` is `false` and an `error` field is included.

Doctor probe/adapters/plugins/MCP JSON contracts: [CODE_REFERENCES.md](CODE_REFERENCES.md) § Doctor Adapter / Plugin / MCP (`src/lib/doctor-probe.ts`, schema version `1`).

## Session-Floor Thresholds

`evaluateSessionFloor()` in `src/lib/effect-gates.ts` uses these hardcoded minimums:

| Field                             | Floor | Meaning                                                                        |
| --------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `rawPromisesRemoved`              | `2`   | At least 2 raw `Promise` usages removed or refactored into Effect per session. |
| `servicesMigratedToTagLayer`      | `2`   | At least 2 services migrated to `Effect.Tag` / `Effect.Layer`.                 |
| `domainPurityViolationsResolved`  | `1`   | At least 1 domain-purity violation resolved.                                   |
| `rawErrorsConvertedToTyped`       | `1`   | At least 1 raw `Error` converted to a typed Effect error.                      |
| `eventEmittersConvertedToStreams` | `0`   | Zero-tolerance field; only negative values fail.                               |
| `circularLayerDependencies`       | `0`   | Zero-tolerance field; only negative values fail.                               |

Rules:

- Missing or non-integer fields are failures.
- Negative values are failures.
- Values below the floor are failures.
- Zero-tolerance fields fail only when the supplied value is negative (they are expected to stay at 0).

Sample envelope: run `kimi-doctor --effect-gates --json` on a clean project; `summary.ok` is `true` when all gate counts are zero and no regressions are detected.

## Taxonomy IDs

The `error-taxonomy.yml` entries used by the Effect gates:

| ID                                            | When emitted                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `effect_gates_threshold_exceeded`             | Gate count exceeds its configured threshold.                                                 |
| `effect_gates_regression_detected`            | `detectRegressions()` finds a count increased since the previous snapshot.                   |
| `effect_gates_manifest_invalid`               | Constants manifest is malformed or out of sync.                                              |
| `effect_gates_session_floor_failed`           | `evaluateSessionFloor()` returns `passed: false`.                                            |
| `effect_gates_run_promise_boundary_violation` | `Effect.runPromise` called outside allowed boundary paths.                                   |
| `effect_gates_event_stream_violation`         | `EventEmitter`-style code found under `src/services/` when event-stream scanning is enabled. |

## Implementation Gaps

| Gap                                                                             | Status     | Notes                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kimi-doctor` reads Effect-discipline constants from `bunfig.toml` `[define]`   | **Closed** | `loadThresholds()` in `src/lib/effect-gates.ts` reads `KIMI_EFFECT_MAX_DIRECT_PROMISE`, `KIMI_DOMAIN_PURITY_LEVEL`, `KIMI_LAYER_CIRCULARITY_TOLERANCE`, `KIMI_SERVICE_TAG_REQUIRED`, and `KIMI_EFFECT_RUN_PROMISE_BOUNDARY_ENABLED`. |
| `kimi-doctor --effect-floor` fails closed on missing/invalid/below-floor values | **Closed** | Invalid input returns exit code `1` with an `error` field; floor evaluation returns `1` when `passed` is `false`.                                                                                                                    |
| Dual `CliContractError` definitions                                             | **Closed** | Effect variant renamed to `EffectCliContractError` in `src/lib/effect/errors.ts`; fields aligned with sync `CliContractError`. See COMPLEXITY-NOTE below.                                                                            |

## Enforcement Surface

Enforced locally via pre-push hooks (`kimi-doctor --effect-gates`) and `bun run ci:local`. Snapshots: `{projectRoot}/.kimi/var/effect-gates.ndjson`. Escape hatch: `KIMI_SKIP_EFFECT_GATES=1` (document in commit message). Gate layers: [AGENTS.md](AGENTS.md#gate-layers).

## COMPLEXITY-NOTE: `CliContractError` / `EffectCliContractError`

There are two representations of the same CLI-contract failure:

1. `src/lib/cli-contract.ts` — `CliContractError`, a plain `Error` subclass thrown by the sync CLI parsing layer. Fields: `toolName`, `taxonomyId`, `unknownFlag?`, `suggestions?`.
2. `src/lib/effect/errors.ts` — `EffectCliContractError`, a `Data.TaggedError("EffectCliContractError")` carried in Effect error channels. Fields: `message`, `toolName`, `taxonomyId`, `unknownFlag?`, `suggestions?`.

`src/lib/effect/cli-contract-effect.ts` converts the sync error into the Effect error when bridging the two layers. They are intentionally not merged into a single class because a plain `Error` cannot serve as a `Data.TaggedError` and vice versa. Do not add a third variant.
