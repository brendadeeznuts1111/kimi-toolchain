// ── Perf Threaded ──────────────────────────────────────────────────

export async function apiPerfThreaded(): Promise<Response> {
  // Worker code: self-contained, Symbol-keyed, no imports from scaffold
  const workerCode = `
declare var self: Worker;
self.onmessage = async (e: MessageEvent) => {
  const { moduleName } = e.data;
  const start = performance.now();
  switch (moduleName) {
    case "crypto.sha256":
      Bun.SHA256.hash("benchmark payload ".repeat(10));
      break;
    case "util.inspect":
      Bun.inspect({ nested: { a: 1, b: { c: [1, 2, 3] }, d: [{ x: "y" }] } }, { sorted: true, colors: false });
      break;
    case "util.deepEquals":
      Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
      break;
    case "image.metadata": {
      const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,2,8,2,0,0,0,0xfd,0xd4,0x9a,0x73,0,0,0,18,73,68,65,84,8,0xd7,99,0xf8,0xcf,0xc0,0,2,12,0,0,9,0,1,0x35,0x8b,0x5a,0xc0,0,0,0,0,73,69,78,68,0xae,66,96,130]);
      const img = new Bun.Image(png);
      await img.metadata();
      break;
    }
  }
  const duration = performance.now() - start;
  self.postMessage({ name: moduleName, actualMs: duration });
};
`;
  await Bun.write("/tmp/_perf_worker.ts", workerCode);

  const modules = ["crypto.sha256", "util.inspect", "util.deepEquals", "image.metadata"];

  const startAll = performance.now();
  const promises = modules.map((name) => {
    return new Promise<{ name: string; actualMs: number }>((resolve, reject) => {
      const worker = new Worker(new URL("file:///tmp/_perf_worker.ts"));
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = (err) => { reject(err); worker.terminate(); };
      worker.postMessage({ moduleName: name });
    });
  });

  const metrics = await Promise.all(promises);
  const totalMs = performance.now() - startAll;
  const allPass = metrics.every((m) => m.actualMs < 5);

  return jsonResponse({
    metrics: metrics.map((m) => ({
      ...m,
      pass: m.actualMs < 5,
      thresholdMs: 5,
    })),
    totalMs,
    concurrent: modules.length,
    speedup: `${(metrics.reduce((s, m) => s + m.actualMs, 0) / totalMs).toFixed(1)}x vs sequential`,
    allPass,
    architecture: "Worker per module → Symbol-keyed handler → postMessage metric → Promise.all collect → pure HTML generation. No shared mutable state (like --isolate).",
  });
}

