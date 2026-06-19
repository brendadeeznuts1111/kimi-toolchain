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

## Complete File Map (9 consolidated files)

| # | File | Contents |
|---|------|----------|
| 1 | `kimi-toolchain-core.ts` | Symbols, validation, gates |
| 2 | `kimi-toolchain-harness.ts` | Transpiler scanner, HTML reporter |
| 3 | `kimi-toolchain-metrics.ts` | Types, thresholds, monitor, CLI |
| 4 | `kimi-toolchain-trained.ts` | Threshold loading, bunfig, `--train` |
| 5 | `kimi-toolchain-scaffold.ts` | Package.json generator, script wiring |
| 6 | `kimi-toolchain-final.ts` | `Bun.TOML.parse`, `kimi-publish` |
| 7 | `kimi-toolchain-herdr.ts` | Watch mode, heal, Herdr `dx.config.toml` |
| 8 | `kimi-toolchain-profile.ts` | `kimi-fix --profile toolchain`, v5.3 spec |
| 9 | `kimi-toolchain-card40.ts` | `DEFAULT_MODULES`, Card #40, dashboard |

### Awk Splitter

Split a consolidated archive back into the 9 individual files:

```bash
awk '
/^\/\/ ={60,}$/ {
    split($0, a, " ")
    file = a[3]
    if (file) print "Writing " file
    next
}
file { print > file }
' kimi-toolchain-v53-consolidated.ts
```

Each file begins with a 60-character `=` separator line followed by the filename.

## Profiles

| Profile | Gates | Follow-Up | Watch Patterns |
|---------|-------|-----------|---------------|
| `toolchain` | check:fast, effect-gates, perf-gates, effect-audit | Domain drift detection, method count | `src/effect/**`, `src/domain/**` |
| `minimal` | check:fast | None | None |
| `ci` | check:fast, test, perf-gates, publish:dry | None | None |

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
export const DEFAULT_MODULES = ['trace', 'perf'];

// KIMI_MODULES=image → includes trace, perf, image
// KIMI_MODULES=image,-perf → includes trace, image (excludes perf)
// KIMI_MODULES=+image → includes only image (no defaults)
```

`resolveModules(input: string): string[]` — `+` prefix skips defaults, `-` prefix excludes specific modules.

## Module Registry (8 entries)

```ts
// src/domain/registry.ts
export const MODULE_REGISTRY: Record<string, ModuleEntry> = {
  trace:       { files: ['trace/validation.ts', 'trace/format.ts'], importPath: './trace/format',  initSymbol: 'kimi.trace',          default: true },
  perf:        { files: ['harness/perf-monitor.ts', 'harness/html-reporter.ts', 'harness/transpiler-scan.ts', 'guardian/perf-gate.ts', 'guardian/effects.ts', 'bin/kimi-doctor.ts', 'bin/kimi-fix.ts', 'bin/kimi-heal.ts'], importPath: './harness/perf-monitor', initSymbol: 'kimi.perf', default: true },
  snapshots:   { files: ['snapshots/snapshot-helper.ts'], importPath: './snapshots/snapshot-helper', initSymbol: 'kimi.snapshot' },
  logging:     { files: ['logging/logger.ts'],            importPath: './logging/logger',           initSymbol: 'kimi.logger' },
  performance: { files: ['performance/marks.ts'],         importPath: './performance/marks',        initSymbol: 'kimi.perfMark' },
  image:       { files: ['image/processor.ts'],           importPath: './image/processor',          initSymbol: 'kimi.effect.image',   thresholdMs: 200 },
  clock:       { files: ['effect/clock.ts'],              importPath: './effect/clock',             initSymbol: 'kimi.effect.clock',   thresholdMs: 0.01 },
  uuid:        { files: ['effect/uuid.ts'],               importPath: './effect/uuid',              initSymbol: 'kimi.effect.uuid',    thresholdMs: 0.1 },
};
```

## Effect Audit (Dimension 8)

| Check | Severity | Rule |
|-------|----------|------|
| `missing-symbol` | error | `EFFECT_PIPELINE` Symbol not registered |
| `bare-promise` | error | `Promise.resolve()` without `Effect.` wrapper |
| `no-tag-service` | error | Domain file imports `getEffect` directly |
| `circular-import` | error | Circular layer dependency detected |

```bash
bun run src/bin/kimi-heal.ts --effect-audit
```

## Card Dashboard (#34–#42)

| # | Card | Status | Commands |
|---|------|--------|----------|
| 34 | snapshot helper | ✓ | `snapshot(label, data, opts)` |
| 35 | coverage gate | ✓ | `test:coverage` |
| 36 | isolate verify | ◌ | — |
| 37 | diff reporter | ◐ | — |
| 39 | table status | ✓ | — |
| 40 | kimi-doctor CLI | ✓ | `doctor`, `doctor:gate`, `doctor:train`, `doctor:watch` |
| 41 | clock module | ✓ | — |
| 42 | uuid module | ✓ | — |

## Herdr Integration

```toml
# dx.config.toml
[finishWork]
gates = ["bun run src/bin/kimi-fix.ts --profile toolchain"]

[doctor]
tabs = [
  { name = "toolchain", cmd = "bun run src/bin/kimi-fix.ts --profile toolchain --watch" },
  { name = "heal", cmd = "bun run src/bin/kimi-heal.ts --watch" },
]
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

| Layer | Implemented | Aspirational |
|-------|-------------|--------------|
| `app`/`toolchain` profiles | ✓ `src/bin/kimi-fix.ts` | |
| `image/processor.ts` (template) | ✓ `templates/modules/` | |
| `perf-gate.ts` | ✓ `src/guardian/` | |
| `html-reporter.ts` | ✓ `src/harness/` | |
| `symbols.ts` | ✓ `examples/dashboard/src/lib/` | |
| `minimal`/`ci` profiles | | ✗ |
| Effect/perf gates as profile steps | | ✗ |
| `--watch` mode | | ✗ |
| `resolveModules()` + `MODULE_REGISTRY` | | ✗ |
| `kimi-heal --effect-audit` (Dimension 8) | | ✗ |
| Clock, uuid, trace, snapshots modules | | ✗ |
| 42-card dashboard UI | | ✗ |
| Herdr dx.config.toml integration | | ✗ |

## Related

| Topic | Path |
|-------|------|
| Memory (canonical spec) | `kimi-fix-profile-v53-spec` |
| Doctor CLI + effects pipeline | [kimi-doctor.md](./kimi-doctor.md) |
| Template families | [template-matrix.md](./template-matrix.md) |
| Configuration layers | [configuration-layers.md](./configuration-layers.md) |
| Namespace boundaries | [namespace.md](./namespace.md) |
| Image effect example | `skills/kimi-toolchain/examples/image-effect.md` |
| Platform absorption | `skills/kimi-toolchain/examples/platform-absorption.md` |
