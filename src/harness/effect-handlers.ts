/**
 * Built-in effect-handler benchmarks.
 *
 * Importing this module registers handlers on the global benchmark registry.
 * Each handler is auto-discovered by `runEffectBenchmarks()` and participates in
 * the closed loop: measure → train → gate → artifact.
 */

import { registerEffectBenchmark } from "../lib/effect-benchmark.ts";
import "./http-effect-handlers.ts";

// Minimal valid PNG (2×2 red pixel)
const SAMPLE_PNG = new Uint8Array([
  0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0,
  0, 0, 0xfd, 0xd4, 0x9a, 0x73, 0, 0, 0, 18, 73, 68, 65, 84, 8, 0xd7, 99, 0xf8, 0xcf, 0xc0, 0, 2,
  12, 0, 0, 9, 0, 1, 0x35, 0x8b, 0x5a, 0xc0, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 66, 96, 130,
]);

registerEffectBenchmark({
  registryKey: "crypto.sha256",
  symbol: "kimi.effect.crypto",
  thresholdMs: 5,
  workload: () => {
    Bun.SHA256.hash("benchmark payload ".repeat(10));
  },
});

registerEffectBenchmark({
  registryKey: "util.inspect",
  symbol: "kimi.effect.inspect",
  thresholdMs: 2,
  workload: () => {
    Bun.inspect({ nested: { a: 1, b: { c: [1, 2, 3] } } }, { sorted: true, colors: false });
  },
});

registerEffectBenchmark({
  registryKey: "util.deepEquals",
  symbol: "kimi.effect.equals",
  thresholdMs: 1,
  workload: () => {
    Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
  },
});

registerEffectBenchmark({
  registryKey: "image.metadata",
  symbol: "kimi.effect.image",
  thresholdMs: 10,
  workload: async () => {
    await new Bun.Image(SAMPLE_PNG).metadata();
  },
});

registerEffectBenchmark({
  registryKey: "clock",
  symbol: "kimi.effect.clock",
  thresholdMs: 0.01,
  workload: () => {
    Bun.nanoseconds();
  },
});

registerEffectBenchmark({
  registryKey: "uuid",
  symbol: "kimi.effect.uuid",
  thresholdMs: 0.1,
  workload: () => {
    Bun.randomUUIDv7();
  },
});
