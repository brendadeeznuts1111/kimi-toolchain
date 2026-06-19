// ── Symbols ────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiSymbols(): Promise<Response> {
  const symbols = {
    domain: [
      {
        key: "kimi.trace",
        interface: "validateAndFormat(traces): string",
        module: "src/trace/format.ts",
      },
      {
        key: "kimi.snapshot",
        interface: "snapshot(label, data, opts?): void",
        module: "src/snapshots/snapshot-helper.ts",
      },
    ],
    effect: [
      {
        key: "kimi.effect.image",
        interface: "ImageEffect",
        module: "src/image/processor.ts",
        methods: ["metadata", "placeholder", "thumbnail", "resize"],
      },
      {
        key: "kimi.effect.trace",
        interface: "same as kimi.trace",
        module: "overlapped with domain",
      },
      { key: "kimi.effect.snapshot", interface: "SnapshotEffect", module: "src/snapshots/" },
      { key: "kimi.effect.logger", interface: "LoggerEffect", module: "src/logging/logger.ts" },
      {
        key: "kimi.effect.performance",
        interface: "{ mark, measure }",
        module: "src/performance/marks.ts",
      },
      { key: "kimi.effect.scaffoldFiles", interface: "ScaffoldEffect", module: "src/effect.ts" },
      {
        key: "kimi.effect.isolation",
        interface: "IsolationEffect (3 backends)",
        module: "examples/dashboard/src/lib/isolation/",
      },
      {
        key: "kimi.effect.uuid",
        interface: "{ generate }",
        module: "templates/modules/uuid/src/processor.ts",
      },
      {
        key: "kimi.effect.clock",
        interface: "{ now }",
        module: "templates/modules/clock/src/processor.ts",
      },
    ],
    harness: [
      { key: "kimi.perfGate", interface: "naming convention", module: "internal pipeline" },
      {
        key: "kimi.effect.perf",
        interface: "overlaps with kimi.effect.performance",
        module: "future expansion",
      },
      { key: "kimi.effect.db", interface: "placeholder", module: "not implemented" },
    ],
  };

  return jsonResponse({
    symbols,
    pipeline: [
      "kimi.effect.image",
      "kimi.effect.trace",
      "kimi.effect.snapshot",
      "kimi.effect.logger",
      "kimi.effect.performance",
      "kimi.effect.isolation",
    ],
    properties: {
      jitMonomorphic: "globalThis[Symbol.for(key)] is stable shape → inlineable",
      treeShaking: "Unused Symbols → dead code eliminated at build",
      zeroCostTesting: "Swap effect implementation, domain unchanged",
      workerParallelism: "Same Symbol keys across processes, no serialization overhead",
    },
    bestPractices: {
      server: "ALS snapshot — domain receives effects as arguments (no global mutation)",
      cli: "globalThis registration — simpler, no request concurrency",
      plugins: "Transpiler.scan() (static reject) + ShadowRealm (runtime isolate)",
      snapshots: "Bun.stripANSI(Bun.inspect.table(data, cols, {colors:true})).toMatchSnapshot()",
    },
    note: "Symbol registry is the abi.ts. Domain = pure contracts. Effect = impure handlers. Harness = internal pipeline. Pipeline order is monomorphically JIT-optimised. Add: define Symbol → MODULE_REGISTRY entry → implement handler → register in init.ts.",
  });
}
