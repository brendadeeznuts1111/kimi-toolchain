// ── Perf Auto-Discover ─────────────────────────────────────────────

export async function apiPerfAutoDiscover(): Promise<Response> {
  const files = [
    { path: "src/lib/isolation/factory.ts", symbol: "kimi.effect.isolation" },
    { path: "src/lib/isolation/realm.ts", symbol: "kimi.effect.isolation" },
    { path: "src/lib/isolation/worker.ts", symbol: "kimi.effect.isolation" },
  ];

  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const discovered: { file: string; symbol: string; exports: string[] }[] = [];
  for (const f of files) {
    const fullPath = `${import.meta.dir}/${f.path}`;
    try {
      const source = await Bun.file(fullPath).text();
      const scan = transpiler.scan(source);
      discovered.push({ file: f.path, symbol: f.symbol, exports: scan.exports });
    } catch {
      discovered.push({ file: f.path, symbol: f.symbol, exports: [] });
    }
  }

  // Auto-benchmark each discovered export
  const metrics: { symbol: string; operation: string; actualMs: number; pass: boolean }[] = [];
  for (const d of discovered) {
    for (const exp of d.exports) {
      const mod = await import(`./${d.file.replace(/\.ts$/, ".ts")}`);
      const fn = mod[exp];
      if (typeof fn !== "function") continue;
      const start = performance.now();
      try {
        if (exp === "createIsolation") {
          (fn("realm") as any).run?.(() => 1);
        } else {
          fn();
        }
        metrics.push({ symbol: d.symbol, operation: exp, actualMs: performance.now() - start, pass: true });
      } catch {
        metrics.push({ symbol: d.symbol, operation: exp, actualMs: -1, pass: false });
      }
    }
  }

  return jsonResponse({
    discovered,
    metrics,
    totalExports: discovered.reduce((s, d) => s + d.exports.length, 0),
    pipeline: "Transpiler.scan(source) → exports[] → dynamic import → benchmark each → Metric[]",
    philosophy: "No manual workload definitions. Source code IS the contract. Works for any effect module — just add its file path.",
  });
}

