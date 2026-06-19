// ── Perf Registry ──────────────────────────────────────────────────

import {
  generatePerfHTML,
  perfGate,
  runEffectBenchmarks,
  trainThresholds,
} from "../harness/index.ts";
import { jsonResponse } from "./shared.ts";

export async function apiPerfRegistry(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const gate = perfGate(metrics);

  return jsonResponse({
    metrics: metrics.map((m) => ({
      name: m.registryKey ?? m.operation,
      symbol: m.symbol,
      actualMs: m.actualMs,
      thresholdMs: m.thresholdMs,
      pass: m.pass,
    })),
    allPass: gate.pass,
    registrySize: metrics.length,
    failures: gate.failures,
    philosophy:
      "MODULE_REGISTRY → runEffectBenchmarks() → loadThresholds() merges thresholds.json over defaults. --train closes the loop.",
  });
}

export async function apiPerfTrain(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const result = await trainThresholds(metrics, import.meta.dir + "/..");
  return jsonResponse({ metrics, train: result });
}

export async function apiPerfReport(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const html = generatePerfHTML(metrics);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Legacy inline harness (kept for Bun.nanoseconds comparison card)

interface ModuleMetrics {
  name: string;
  actualMs: number;
  thresholdMs?: number;
  pass: boolean;
  note?: string;
}

export async function apiPerfHarness(): Promise<Response> {
  const metrics: ModuleMetrics[] = [];

  // Measure each effect module
  const t0 = Bun.nanoseconds();
  void new Uint8Array(await Bun.SHA256.hash("benchmark payload"));
  const t1 = Bun.nanoseconds();
  metrics.push({
    name: "crypto.sha256",
    actualMs: Number(t1 - t0) / 1_000_000,
    thresholdMs: 5,
    pass: Number(t1 - t0) / 1_000_000 < 5,
    note: "Bun.SHA256.hash()",
  });

  const t2 = Bun.nanoseconds();
  const img = new Bun.Image(
    new Uint8Array([
      0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2,
      0, 0, 0, 0xfd, 0xd4, 0x9a, 0x73, 0, 0, 0, 18, 73, 68, 65, 84, 8, 0xd7, 99, 0xf8, 0xcf, 0xc0,
      0, 2, 12, 0, 0, 9, 0, 1, 0x35, 0x8b, 0x5a, 0xc0, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 66, 96,
      130,
    ])
  );
  const meta = await img.metadata();
  const t3 = Bun.nanoseconds();
  metrics.push({
    name: "image.metadata",
    actualMs: Number(t3 - t2) / 1_000_000,
    thresholdMs: 10,
    pass: Number(t3 - t2) / 1_000_000 < 10,
    note: `${meta.width}×${meta.height} ${meta.format}`,
  });

  const t4 = Bun.nanoseconds();
  Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
  const t5 = Bun.nanoseconds();
  metrics.push({
    name: "util.deepEquals",
    actualMs: Number(t5 - t4) / 1_000_000,
    thresholdMs: 1,
    pass: Number(t5 - t4) / 1_000_000 < 1,
    note: "nested object comparison",
  });

  const t6 = Bun.nanoseconds();
  Bun.inspect({ nested: { a: 1, b: { c: [1, 2, 3] } } }, { sorted: true, colors: false });
  const t7 = Bun.nanoseconds();
  metrics.push({
    name: "util.inspect",
    actualMs: Number(t7 - t6) / 1_000_000,
    thresholdMs: 2,
    pass: Number(t7 - t6) / 1_000_000 < 2,
    note: "Bun.inspect with sorted:true",
  });

  const allPass = metrics.every((m) => m.pass);

  return jsonResponse({
    metrics,
    allPass,
    summary: `${metrics.filter((m) => m.pass).length}/${metrics.length} modules within threshold`,
    philosophy:
      "Every Symbol-keyed effect produces a measurable artifact. Performance harness calls real (or fake) effect, measures elapsed, feeds into HTML table. Pure, deterministic, snapshot-testable.",
  });
}
