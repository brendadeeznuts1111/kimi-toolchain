#!/usr/bin/env bun
/**
 * effect-benchmark.ts — Run registered effect-handler benchmarks and evaluate the gate.
 *
 * Usage:
 *   bun run perf:effect-handlers
 *   bun run perf:effect-handlers --json
 */

import { join } from "path";
import { runEffectBenchmarks } from "../src/harness/perf-monitor.ts";
import { evaluateEffectBenchmarkGate } from "../src/lib/effect-benchmark.ts";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const metrics = await runEffectBenchmarks({ projectRoot: REPO_ROOT });
  const gate = await evaluateEffectBenchmarkGate(metrics, undefined, REPO_ROOT);

  if (json) {
    writeStdoutJsonSync(
      {
        schemaVersion: 1,
        tool: "effect-benchmark",
        metrics: metrics.length,
        gatePass: gate.pass,
        failures: gate.failures,
      },
      2
    );
  } else {
    console.log(`Effect benchmarks: ${metrics.length} handlers`);
    console.log(`Gate: ${gate.pass ? "PASS" : "FAIL"}`);
    for (const f of gate.failures) console.error(`  - ${f}`);
  }

  return gate.pass ? 0 : 1;
}

main().catch((err: Error) => {
  console.error("effect-benchmark failed:", err.message);
  process.exit(1);
});
