import { jsonResponse } from "./shared.ts";

export async function apiEffectImage(): Promise<Response> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const source = await Bun.file(`${import.meta.dir}/../effect/image/processor.ts`).text();
  const scan = transpiler.scan(source);
  const mod = await import("../effect/image/processor.ts");

  const metrics: {
    operation: string;
    actualMs: number;
    thresholdMs: number;
    pass: boolean;
  }[] = [];

  for (const exp of scan.exports) {
    const fn = (mod as Record<string, unknown>)[exp];
    if (typeof fn !== "function" || exp === "imageEffect") continue;

    const start = performance.now();
    try {
      await (fn as () => Promise<unknown>)();
      const elapsed = performance.now() - start;
      const threshold = exp === "workload" ? 20 : exp === "convertFormats" ? 15 : 10;
      metrics.push({
        operation: exp,
        actualMs: Math.round(elapsed * 1000) / 1000,
        thresholdMs: threshold,
        pass: elapsed <= threshold,
      });
    } catch {
      metrics.push({ operation: exp, actualMs: -1, thresholdMs: 10, pass: false });
    }
  }

  const trained: Record<string, number> = {};
  for (const m of metrics) {
    if (m.actualMs > 0) {
      trained[`kimi.effect.image.${m.operation}`] = Math.round(m.actualMs * 1.1 * 1000) / 1000;
    }
  }

  const passCount = metrics.filter((m) => m.pass).length;
  const report = `📊 ${passCount}/${metrics.length} operations within thresholds\n${metrics
    .map(
      (m) =>
        `  ${m.operation}: ${m.actualMs > 0 ? m.actualMs + "ms" : "ERR"} ≤ ${m.thresholdMs}ms ${m.pass ? "✅" : "❌"}`
    )
    .join("\n")}`;

  return jsonResponse({
    pipeline: [
      "1. Transpiler.scan(source) → exports",
      "2. Dynamic import → real effect handler",
      "3. Benchmark each → Metric[]",
      "4. Train → thresholds with 10% margin",
      "5. Report → human-readable summary",
    ],
    scan: { file: "effect/image/processor.ts", exports: scan.exports },
    metrics,
    trained,
    report,
    symbolKey: "Symbol.for('kimi.effect.image')",
    note: "Full closed loop: scan → import → benchmark → train → report.",
  });
}