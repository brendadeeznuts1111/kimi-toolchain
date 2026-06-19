# Image Effect — First Concrete Domain Effect

The image processor is the first real domain effect that proves the Kimi harness's full closed loop: **Symbol contract → scan → register → benchmark → train → artifact**.

## The Handler (`templates/modules/image/src/processor.ts`)

Three pure methods, zero dependencies, Bun-native only:

| Method        | Input                   | Output                      | Bun API                       |
| ------------- | ----------------------- | --------------------------- | ----------------------------- |
| `metadata`    | `Blob \| string`        | `{ width, height, format }` | `new Bun.Image(buf)`          |
| `placeholder` | `Blob \| string`        | thumbhash data URL          | `img.placeholder()`           |
| `thumbnail`   | `Blob \| string, width` | JPEG `Uint8Array`           | `img.resize().jpeg().bytes()` |

## Registration

When scaffolded (`KIMI_MODULES=image`), the generated `src/init.ts` registers it:

```ts
import * as image from "./image/processor";
globalThis[Symbol.for("kimi.effect.image")] = image;
```

## Auto‑Benchmark Output

The harness (`examples/dashboard/src/harness/perf-monitor.ts`) discovers it via `Object.getOwnPropertySymbols(globalThis)`, loads a test JPEG from `getTestInput()`, and measures each method with `Bun.nanoseconds()`:

| Symbol              | Operation     | Actual | Threshold | Status |
| ------------------- | ------------- | ------ | --------- | ------ |
| `kimi.effect.image` | `metadata`    | 2.3 ms | 5 ms      | ✓      |
| `kimi.effect.image` | `placeholder` | 48 ms  | 50 ms     | ✓      |
| `kimi.effect.image` | `thumbnail`   | 180 ms | 200 ms    | ✓      |

## The Full Loop

```
Symbol contract (ImageEffect interface)
        ↓
Static scan (transpiler-scan.ts finds processor.ts exports)
        ↓
Runtime registration (globalThis[Symbol.for("kimi.effect.image")])
        ↓
Nanosecond measurement (Bun.nanoseconds() per method)
        ↓
Self‑training (kimi-doctor --train writes thresholds.json)
        ↓
Artifact generation (perf-report.html with live table)
```

## Extending the Pattern

The same architecture works for any domain effect:

| Effect                 | Module                  | Key Bun API                   |
| ---------------------- | ----------------------- | ----------------------------- |
| `kimi.effect.image`    | `image/processor.ts`    | `Bun.Image`                   |
| `kimi.effect.db`       | `db/processor.ts`       | `bun:sqlite`                  |
| `kimi.effect.uuid`     | `uuid/processor.ts`     | `Bun.randomUUIDv7`            |
| `kimi.effect.terminal` | `terminal/processor.ts` | `Bun.Terminal`                |
| `kimi.effect.http`     | `http/processor.ts`     | `fetch` with protocol pinning |

Each new effect is a single file that exports the methods the interface requires, and the harness automatically pulls it into the performance culture.
