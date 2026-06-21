// ── Symbols ────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiSymbols(): Promise<Response> {
  const symbols = {
    domain: [
      {
        key: "kimi.trace",
        interface: "validateAndFormat(traces): string",
        module: "src/lib/trace-format.ts (conceptual)",
      },
      {
        key: "kimi.snapshot",
        interface: "snapshot(label, data, opts?): void",
        module: "src/lib/snapshot-helper.ts (conceptual)",
      },
    ],
    effect: [
      {
        key: "kimi.effect.image",
        interface: "ImageEffect",
        module: "templates/modules/image/src/processor.ts",
        methods: ["metadata", "placeholder", "thumbnail"],
      },
      {
        key: "kimi.effect.trace",
        interface: "same as kimi.trace",
        module: "overlapped with domain",
      },
      {
        key: "kimi.effect.snapshot",
        interface: "SnapshotEffect",
        module: "templates/modules/snapshot/processor.ts (conceptual)",
      },
      {
        key: "kimi.effect.logger",
        interface: "LoggerEffect",
        module: "src/lib/logger.ts",
      },
      {
        key: "kimi.effect.performance",
        interface: "{ mark, measure }",
        module: "examples/dashboard/src/harness/perf-monitor.ts",
      },
      {
        key: "kimi.effect.scaffoldFiles",
        interface: "ScaffoldEffect",
        module: "src/lib/scaffold-templates.ts",
      },
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
      {
        key: "kimi.effect.db",
        interface: "SqliteEffect",
        module: "templates/modules/db/src/processor.ts",
      },
      {
        key: "kimi.effect.terminal",
        interface: "TerminalEffect",
        module: "templates/modules/terminal/src/processor.ts",
      },
      {
        key: "kimi.effect.http",
        interface: "HttpEffect",
        module: "templates/modules/http/src/processor.ts",
      },
    ],
    harness: [
      { key: "kimi.perfGate", interface: "naming convention", module: "internal pipeline" },
      {
        key: "kimi.effect.perf",
        interface: "overlaps with kimi.effect.performance",
        module: "examples/dashboard/src/harness/perf-monitor.ts",
      },
    ],
  };

  return jsonResponse({
    symbols,
    pipeline: [
      "kimi.effect.image",
      "kimi.effect.trace",
      "kimi.effect.performance",
      "kimi.effect.isolation",
      "kimi.effect.uuid",
      "kimi.effect.clock",
      "kimi.effect.db",
      "kimi.effect.terminal",
      "kimi.effect.http",
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
